import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a Google Ads query interpreter. Your job is to convert a user's natural language question about their Google Ads account into a structured JSON intent.

You must output ONLY valid JSON with this schema:
{
  "date_range": string,         // one of: today, yesterday, last_7_days, last_week, last_14_days, last_30_days, this_month, last_month, last_90_days
  "comparison_range": string|null, // if the user asks for comparison (e.g., "vs last month"), the second range
  "metrics": string[],          // from: cost, impressions, clicks, conversions, conversion_value, ctr, cpc, cpl, cvr, roas, impression_share, lost_is_budget, lost_is_rank
  "dimensions": string[],       // from: campaign, ad_group, keyword, search_term, device, geo, date
  "analysis_type": string,      // one of: overview, diagnostic, recommendation, audit, comparison, anomaly
  "filters": object|null,       // e.g., { "campaign_status": "ENABLED" } or { "campaign_name_contains": "Brand" }
  "sort_by": string|null,       // metric to sort by
  "sort_order": string|null,    // "asc" or "desc"
  "limit": number|null,         // max rows (for "top N" queries)
  "follow_up_context": string|null // if this is a follow-up, what context from prior messages is relevant
}

Rules:
- Default date_range to "last_30_days" if unspecified.
- Default dimensions to ["campaign"] if unspecified.
- For "why" questions, use analysis_type "diagnostic" and include the date dimension to spot trends.
- For "what should I" questions, use analysis_type "recommendation".
- For "how are" or "show me" questions, use analysis_type "overview".
- For audit-style questions ("wasting spend", "losing money"), use analysis_type "audit".
- For comparison questions, set both date_range and comparison_range.
- Always include "cost" and "conversions" in metrics unless the question is clearly only about impressions/clicks.
- For CPL questions, include: cost, conversions, cpl.
- For efficiency questions, include: cost, conversions, cpl, cvr, roas.
- If the user asks about keywords, set dimensions to include "keyword".
- If the user asks about search terms, set dimensions to include "search_term".
- Filter to ENABLED campaigns by default unless the user asks about paused campaigns.`;

export class QueryUnderstandingLayer {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  async parse(question, conversationHistory = []) {
    const contextMessages = conversationHistory.slice(-6).map((m) => ({
      role: m.role,
      content: m.role === 'user' ? m.content : (m.dataSummary ? `[Previous answer about: ${JSON.stringify(m.intent)}]` : m.content),
    }));

    const messages = [
      ...contextMessages,
      { role: 'user', content: question },
    ];

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content[0].text.trim();

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const parsed = JSON.parse(jsonMatch[1].trim());

    return this.validate(parsed);
  }

  validate(intent) {
    const validAnalysisTypes = ['overview', 'diagnostic', 'recommendation', 'audit', 'comparison', 'anomaly'];
    const validDimensions = ['campaign', 'ad_group', 'keyword', 'search_term', 'device', 'geo', 'date'];

    if (!validAnalysisTypes.includes(intent.analysis_type)) {
      intent.analysis_type = 'overview';
    }
    intent.dimensions = (intent.dimensions || ['campaign']).filter(d => validDimensions.includes(d));
    if (intent.dimensions.length === 0) intent.dimensions = ['campaign'];
    intent.metrics = intent.metrics || ['cost', 'clicks', 'conversions', 'cpl'];
    intent.date_range = intent.date_range || 'last_30_days';

    return intent;
  }
}
