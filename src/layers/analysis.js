import Anthropic from '@anthropic-ai/sdk';
import { CurlAnthropicClient } from '../utils/curl-client.js';

const ANALYSIS_SYSTEM_PROMPT = `You are an expert Google Ads analyst. You receive structured data about a user's Google Ads account and must provide clear, specific, actionable analysis.

Your response must be valid JSON with this exact structure:
{
  "answer": "A 2-4 sentence direct answer to the user's question, referencing specific numbers from the data.",
  "insights": [
    "Insight 1 — specific, data-backed observation",
    "Insight 2 — specific, data-backed observation",
    "Insight 3 (if applicable)"
  ],
  "recommendations": [
    "Action 1 — specific, implementable recommendation",
    "Action 2 — specific, implementable recommendation",
    "Action 3 (if applicable)"
  ]
}

Rules:
- NEVER give generic advice. Every statement must reference specific campaigns, numbers, or trends from the data.
- Use actual dollar amounts, percentages, and campaign names.
- If CPL increased, explain which campaigns drove it up and by how much.
- If asked about waste, identify specific campaigns/keywords with high cost and low/no conversions.
- For recommendations, include specific actions: "Pause keyword X in campaign Y" not "Consider pausing underperforming keywords".
- If data is insufficient, say so clearly rather than guessing.
- Keep each insight to 1-2 sentences max.
- Keep each recommendation to 1 sentence with a specific action.`;

const ANALYSIS_TYPE_INSTRUCTIONS = {
  overview: 'Provide a performance summary. Lead with the most important metric changes.',
  diagnostic: `Diagnose WHY the metric changed. Look at:
1. Which campaigns drove the change
2. Daily trends — when did the shift happen?
3. Anomalies — any spikes or drops?
4. External factors to consider (seasonality, budget changes)`,
  recommendation: `Recommend specific optimizations. Prioritize by impact:
1. Quick wins (pause wasteful keywords/campaigns)
2. Budget reallocation opportunities
3. Bid adjustments
4. Structural improvements`,
  audit: `Audit for waste and inefficiency. Flag:
1. Campaigns with spend but zero conversions
2. Keywords with high CPC but no conversions
3. Search terms that are irrelevant
4. Budget lost to impression share
5. Campaigns with declining efficiency trends`,
  comparison: 'Compare the two periods. Highlight what improved, what declined, and what drove the changes.',
  anomaly: 'Focus on the anomalies detected. Explain what happened, when, and likely causes.',
};

export class AnalysisLayer {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.curl = new CurlAnthropicClient(apiKey);
    try {
      this.client = new Anthropic({ apiKey });
    } catch {
      this.client = null;
    }
  }

  async analyze({ question, intent, data, history }) {
    const typeInstruction = ANALYSIS_TYPE_INSTRUCTIONS[intent.analysis_type] || ANALYSIS_TYPE_INSTRUCTIONS.overview;

    const dataContext = this.formatDataForPrompt(data);

    const conversationContext = history.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');

    const userPrompt = `## User Question
${question}

## Analysis Type
${intent.analysis_type}: ${typeInstruction}

## Intent
${JSON.stringify(intent, null, 2)}

## Data
${dataContext}

${conversationContext ? `## Recent Conversation Context\n${conversationContext}` : ''}

Analyze this data and respond with JSON only.`;

    const params = {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    };

    let response;
    try {
      if (this.client) {
        response = await Promise.race([
          this.client.messages.create(params),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SDK timeout')), 10000)),
        ]);
      } else {
        throw new Error('SDK not available');
      }
    } catch {
      response = await this.curl.createMessage(params);
    }

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];

    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // If Claude didn't return valid JSON, wrap the text response
      return {
        answer: text.slice(0, 500),
        insights: ['Unable to parse structured response — raw analysis provided above.'],
        recommendations: [],
      };
    }
  }

  formatDataForPrompt(data) {
    const parts = [];

    parts.push(`### Summary\n${data.summary}`);

    if (data.tables.primary?.length) {
      parts.push(`### Primary Data (${data.tables.primary.length} rows)`);
      // Show top 20 rows to keep prompt manageable
      const displayRows = data.tables.primary.slice(0, 20);
      parts.push(this.formatTable(displayRows));
      if (data.tables.primary.length > 20) {
        parts.push(`... and ${data.tables.primary.length - 20} more rows`);
      }
    }

    if (data.tables.changes) {
      parts.push(`### Period Comparison`);
      parts.push(JSON.stringify(data.tables.changes, null, 2));
    }

    if (data.tables.anomalies?.length) {
      parts.push(`### Anomalies Detected`);
      parts.push(JSON.stringify(data.tables.anomalies.slice(0, 10), null, 2));
    }

    if (data.tables.search_terms?.length) {
      parts.push(`### Top Search Terms by Cost`);
      parts.push(this.formatTable(data.tables.search_terms.slice(0, 15)));
    }

    if (data.tables.primary?.length === 0 && !data.tables.changes) {
      parts.push('### ⚠ No data returned. The account may have no activity in the selected date range.');
    }

    return parts.join('\n\n');
  }

  formatTable(rows) {
    if (!rows.length) return '(empty)';
    const keys = Object.keys(rows[0]).filter(k => rows[0][k] !== null && rows[0][k] !== undefined);
    const header = keys.join(' | ');
    const separator = keys.map(() => '---').join(' | ');
    const body = rows.map(r => keys.map(k => r[k] ?? '—').join(' | ')).join('\n');
    return `${header}\n${separator}\n${body}`;
  }
}
