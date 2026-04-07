/**
 * Application defaults and constants.
 * All tunable knobs in one place — no magic numbers scattered in business logic.
 */

export const DATE_RANGES = {
  today: { label: 'Today', gaqlSegment: 'TODAY' },
  yesterday: { label: 'Yesterday', gaqlSegment: 'YESTERDAY' },
  last_7_days: { label: 'Last 7 Days', gaqlSegment: 'LAST_7_DAYS' },
  last_week: { label: 'Last Week (Mon–Sun)', gaqlSegment: 'LAST_BUSINESS_WEEK' },
  last_14_days: { label: 'Last 14 Days', gaqlSegment: 'LAST_14_DAYS' },
  last_30_days: { label: 'Last 30 Days', gaqlSegment: 'LAST_30_DAYS' },
  this_month: { label: 'This Month', gaqlSegment: 'THIS_MONTH' },
  last_month: { label: 'Last Month', gaqlSegment: 'LAST_MONTH' },
  last_90_days: { label: 'Last 90 Days', custom: true, days: 90 },
};

export const METRIC_DEFINITIONS = {
  cost: { gaqlField: 'metrics.cost_micros', transform: v => v / 1_000_000, label: 'Cost', format: 'currency' },
  impressions: { gaqlField: 'metrics.impressions', label: 'Impressions', format: 'number' },
  clicks: { gaqlField: 'metrics.clicks', label: 'Clicks', format: 'number' },
  conversions: { gaqlField: 'metrics.conversions', label: 'Conversions', format: 'number' },
  conversion_value: { gaqlField: 'metrics.conversions_value', label: 'Conv. Value', format: 'currency' },
  ctr: { gaqlField: 'metrics.ctr', label: 'CTR', format: 'percent' },
  cpc: { gaqlField: 'metrics.average_cpc', transform: v => v / 1_000_000, label: 'Avg. CPC', format: 'currency' },
  cpl: { computed: true, formula: (cost, conversions) => conversions > 0 ? cost / conversions : null, label: 'CPL', format: 'currency' },
  cvr: { computed: true, formula: (conversions, clicks) => clicks > 0 ? conversions / clicks : null, label: 'CVR', format: 'percent' },
  roas: { computed: true, formula: (convValue, cost) => cost > 0 ? convValue / cost : null, label: 'ROAS', format: 'ratio' },
  impression_share: { gaqlField: 'metrics.search_impression_share', label: 'Impression Share', format: 'percent' },
  lost_is_budget: { gaqlField: 'metrics.search_budget_lost_impression_share', label: 'Lost IS (Budget)', format: 'percent' },
  lost_is_rank: { gaqlField: 'metrics.search_rank_lost_impression_share', label: 'Lost IS (Rank)', format: 'percent' },
};

export const DIMENSION_FIELDS = {
  campaign: { gaqlResource: 'campaign', fields: ['campaign.id', 'campaign.name', 'campaign.status'] },
  ad_group: { gaqlResource: 'ad_group', fields: ['ad_group.id', 'ad_group.name', 'ad_group.status', 'campaign.name'] },
  keyword: { gaqlResource: 'ad_group_criterion', fields: ['ad_group_criterion.keyword.text', 'ad_group_criterion.keyword.match_type', 'ad_group.name', 'campaign.name'] },
  search_term: { gaqlResource: 'search_term_view', fields: ['search_term_view.search_term', 'campaign.name', 'ad_group.name'] },
  device: { gaqlSegment: 'segments.device', fields: ['segments.device'] },
  geo: { gaqlResource: 'geographic_view', fields: ['geographic_view.country_criterion_id'] },
  date: { gaqlSegment: 'segments.date', fields: ['segments.date'] },
};

export const ANALYSIS_TYPES = ['overview', 'diagnostic', 'recommendation', 'audit', 'comparison', 'anomaly'];

export const CACHE_TTL_SECONDS = 300; // 5 minutes for GAQL result cache

export const MAX_ROWS_PER_QUERY = 10_000;

export const CONVERSATION_CONTEXT_WINDOW = 10; // how many past messages to feed Claude for context
