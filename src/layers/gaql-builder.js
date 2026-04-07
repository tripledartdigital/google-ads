import { METRIC_DEFINITIONS, DIMENSION_FIELDS, DATE_RANGES, MAX_ROWS_PER_QUERY } from '../../config/defaults.js';

/**
 * Converts a structured intent into one or more GAQL queries.
 *
 * Returns an object like:
 *   { primary: "SELECT ... FROM ...", comparison: "SELECT ... FROM ..." }
 *
 * The "comparison" key only exists when the intent has a comparison_range.
 */
export class GAQLBuilder {
  build(intent) {
    const queries = {};

    queries.primary = this.buildSingle(intent, intent.date_range);

    if (intent.comparison_range) {
      queries.comparison = this.buildSingle(intent, intent.comparison_range);
    }

    // For diagnostic analysis, also fetch daily data to find trends
    if (intent.analysis_type === 'diagnostic' && !intent.dimensions.includes('date')) {
      const diagnosticIntent = { ...intent, dimensions: [...intent.dimensions, 'date'] };
      queries.daily_trend = this.buildSingle(diagnosticIntent, intent.date_range);
    }

    // For audit analysis, also fetch search terms to find waste
    if (intent.analysis_type === 'audit' && !intent.dimensions.includes('search_term')) {
      const stIntent = {
        ...intent,
        dimensions: ['search_term'],
        sort_by: 'cost',
        sort_order: 'desc',
        limit: 50,
      };
      queries.search_terms = this.buildSingle(stIntent, intent.date_range);
    }

    return queries;
  }

  buildSingle(intent, dateRange) {
    const resource = this.getResource(intent.dimensions);
    const selectFields = this.getSelectFields(intent);
    const conditions = this.getConditions(intent, dateRange);
    const orderBy = this.getOrderBy(intent);
    const limit = intent.limit || MAX_ROWS_PER_QUERY;

    let gaql = `SELECT ${selectFields.join(', ')} FROM ${resource}`;

    if (conditions.length > 0) {
      gaql += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (orderBy) {
      gaql += ` ORDER BY ${orderBy}`;
    }

    gaql += ` LIMIT ${limit}`;

    return gaql;
  }

  getResource(dimensions) {
    // Priority: most specific resource wins
    if (dimensions.includes('search_term')) return 'search_term_view';
    if (dimensions.includes('keyword')) return 'keyword_view';
    if (dimensions.includes('geo')) return 'geographic_view';
    if (dimensions.includes('ad_group')) return 'ad_group';
    return 'campaign';
  }

  getSelectFields(intent) {
    const fields = new Set();

    // Add dimension fields
    for (const dim of intent.dimensions) {
      const def = DIMENSION_FIELDS[dim];
      if (!def) continue;
      for (const f of def.fields) {
        fields.add(f);
      }
    }

    // Add metric fields (skip computed metrics — they're calculated in DataProcessor)
    for (const metric of intent.metrics) {
      const def = METRIC_DEFINITIONS[metric];
      if (!def || def.computed) continue;
      fields.add(def.gaqlField);
    }

    // Always include cost_micros and conversions for computed metrics
    const needsComputed = intent.metrics.some(m => METRIC_DEFINITIONS[m]?.computed);
    if (needsComputed) {
      fields.add('metrics.cost_micros');
      fields.add('metrics.conversions');
      fields.add('metrics.clicks');
      fields.add('metrics.conversions_value');
    }

    return [...fields];
  }

  getConditions(intent, dateRange) {
    const conditions = [];

    // Date range
    const rangeDef = DATE_RANGES[dateRange];
    if (rangeDef) {
      if (rangeDef.custom) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - rangeDef.days);
        conditions.push(
          `segments.date >= '${this.formatDate(start)}'`,
          `segments.date <= '${this.formatDate(end)}'`
        );
      } else {
        conditions.push(`segments.date DURING ${rangeDef.gaqlSegment}`);
      }
    }

    // Filters from intent
    if (intent.filters) {
      if (intent.filters.campaign_status) {
        conditions.push(`campaign.status = '${intent.filters.campaign_status}'`);
      }
      if (intent.filters.campaign_name_contains) {
        conditions.push(`campaign.name LIKE '%${intent.filters.campaign_name_contains}%'`);
      }
      if (intent.filters.ad_group_status) {
        conditions.push(`ad_group.status = '${intent.filters.ad_group_status}'`);
      }
    }

    return conditions;
  }

  getOrderBy(intent) {
    if (!intent.sort_by) return null;
    const def = METRIC_DEFINITIONS[intent.sort_by];
    if (!def || def.computed) {
      // For computed metrics, sort by cost as a proxy
      return `metrics.cost_micros ${intent.sort_order?.toUpperCase() || 'DESC'}`;
    }
    return `${def.gaqlField} ${intent.sort_order?.toUpperCase() || 'DESC'}`;
  }

  formatDate(date) {
    return date.toISOString().split('T')[0];
  }
}
