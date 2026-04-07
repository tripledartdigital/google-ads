import { METRIC_DEFINITIONS } from '../../config/defaults.js';

/**
 * Takes raw MCP query results and produces:
 *   - Cleaned, aggregated tables
 *   - Computed metrics (CPL, CVR, ROAS)
 *   - Period-over-period comparisons
 *   - Anomaly flags
 *   - A textual summary for Claude
 */
export class DataProcessor {
  process(rawResults, intent) {
    const tables = {};
    let totalRows = 0;

    // Process primary results
    if (rawResults.primary && !rawResults.primary.error) {
      tables.primary = this.transformRows(rawResults.primary, intent);
      totalRows += tables.primary.length;
    }

    // Process comparison period
    if (rawResults.comparison && !rawResults.comparison.error) {
      tables.comparison = this.transformRows(rawResults.comparison, intent);
      totalRows += tables.comparison.length;

      tables.changes = this.computeChanges(tables.primary, tables.comparison, intent);
    }

    // Process daily trend
    if (rawResults.daily_trend && !rawResults.daily_trend.error) {
      tables.daily_trend = this.transformRows(rawResults.daily_trend, intent);
      totalRows += tables.daily_trend.length;
      tables.anomalies = this.detectAnomalies(tables.daily_trend);
    }

    // Process search terms
    if (rawResults.search_terms && !rawResults.search_terms.error) {
      tables.search_terms = this.transformRows(rawResults.search_terms, intent);
      totalRows += tables.search_terms.length;
    }

    // Build summary
    const summary = this.buildSummary(tables, intent);

    return { tables, summary, totalRows };
  }

  transformRows(rawData, intent) {
    // MCP returns data as an array of objects with GAQL field paths as keys
    const rows = Array.isArray(rawData) ? rawData : (rawData.results || []);

    return rows.map((row) => {
      const transformed = {};

      // Extract dimension values
      if (row.campaign) {
        transformed.campaign_name = row.campaign.name;
        transformed.campaign_id = row.campaign.id;
        transformed.campaign_status = row.campaign.status;
      }
      if (row.adGroup) {
        transformed.ad_group_name = row.adGroup.name;
        transformed.ad_group_id = row.adGroup.id;
      }
      if (row.adGroupCriterion?.keyword) {
        transformed.keyword = row.adGroupCriterion.keyword.text;
        transformed.match_type = row.adGroupCriterion.keyword.matchType;
      }
      if (row.searchTermView) {
        transformed.search_term = row.searchTermView.searchTerm;
      }
      if (row.segments) {
        if (row.segments.date) transformed.date = row.segments.date;
        if (row.segments.device) transformed.device = row.segments.device;
      }

      // Extract and transform metrics
      const metrics = row.metrics || {};
      const cost = (metrics.costMicros || 0) / 1_000_000;
      const clicks = metrics.clicks || 0;
      const impressions = metrics.impressions || 0;
      const conversions = metrics.conversions || 0;
      const conversionValue = metrics.conversionsValue || 0;

      transformed.cost = Math.round(cost * 100) / 100;
      transformed.clicks = clicks;
      transformed.impressions = impressions;
      transformed.conversions = Math.round(conversions * 100) / 100;
      transformed.conversion_value = Math.round(conversionValue * 100) / 100;
      transformed.ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
      transformed.cpc = clicks > 0 ? Math.round((cost / clicks) * 100) / 100 : 0;
      transformed.cpl = conversions > 0 ? Math.round((cost / conversions) * 100) / 100 : null;
      transformed.cvr = clicks > 0 ? Math.round((conversions / clicks) * 10000) / 100 : 0;
      transformed.roas = cost > 0 ? Math.round((conversionValue / cost) * 100) / 100 : null;

      if (metrics.searchImpressionShare !== undefined) {
        transformed.impression_share = metrics.searchImpressionShare;
      }
      if (metrics.searchBudgetLostImpressionShare !== undefined) {
        transformed.lost_is_budget = metrics.searchBudgetLostImpressionShare;
      }
      if (metrics.searchRankLostImpressionShare !== undefined) {
        transformed.lost_is_rank = metrics.searchRankLostImpressionShare;
      }

      return transformed;
    });
  }

  computeChanges(current, previous, intent) {
    if (!current || !previous) return null;

    // Aggregate totals for each period
    const currentTotals = this.aggregate(current);
    const previousTotals = this.aggregate(previous);

    const changes = {};
    for (const metric of ['cost', 'clicks', 'impressions', 'conversions', 'conversion_value']) {
      const curr = currentTotals[metric] || 0;
      const prev = previousTotals[metric] || 0;
      changes[metric] = {
        current: curr,
        previous: prev,
        change: curr - prev,
        changePercent: prev > 0 ? Math.round(((curr - prev) / prev) * 10000) / 100 : null,
      };
    }

    // Computed metric changes
    changes.cpl = {
      current: currentTotals.conversions > 0 ? currentTotals.cost / currentTotals.conversions : null,
      previous: previousTotals.conversions > 0 ? previousTotals.cost / previousTotals.conversions : null,
    };
    if (changes.cpl.current && changes.cpl.previous) {
      changes.cpl.change = changes.cpl.current - changes.cpl.previous;
      changes.cpl.changePercent = Math.round(((changes.cpl.current - changes.cpl.previous) / changes.cpl.previous) * 10000) / 100;
    }

    return changes;
  }

  detectAnomalies(dailyData) {
    if (!dailyData || dailyData.length < 3) return [];

    const anomalies = [];
    const metrics = ['cost', 'clicks', 'conversions', 'cpl'];

    for (const metric of metrics) {
      const values = dailyData.map(d => d[metric]).filter(v => v !== null && v !== undefined);
      if (values.length < 3) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev === 0) continue;

      dailyData.forEach((day) => {
        const val = day[metric];
        if (val === null || val === undefined) return;
        const zScore = (val - mean) / stdDev;

        if (Math.abs(zScore) > 2) {
          anomalies.push({
            date: day.date,
            metric,
            value: val,
            mean: Math.round(mean * 100) / 100,
            zScore: Math.round(zScore * 100) / 100,
            direction: zScore > 0 ? 'spike' : 'drop',
            campaign: day.campaign_name,
          });
        }
      });
    }

    return anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  }

  aggregate(rows) {
    return rows.reduce((acc, row) => {
      acc.cost = (acc.cost || 0) + (row.cost || 0);
      acc.clicks = (acc.clicks || 0) + (row.clicks || 0);
      acc.impressions = (acc.impressions || 0) + (row.impressions || 0);
      acc.conversions = (acc.conversions || 0) + (row.conversions || 0);
      acc.conversion_value = (acc.conversion_value || 0) + (row.conversion_value || 0);
      return acc;
    }, {});
  }

  buildSummary(tables, intent) {
    const parts = [];

    if (tables.primary?.length) {
      const totals = this.aggregate(tables.primary);
      parts.push(`Period totals: $${totals.cost.toFixed(2)} spent, ${totals.clicks} clicks, ${totals.conversions} conversions`);
      if (totals.conversions > 0) {
        parts.push(`CPL: $${(totals.cost / totals.conversions).toFixed(2)}, CVR: ${((totals.conversions / totals.clicks) * 100).toFixed(2)}%`);
      }
      parts.push(`Across ${tables.primary.length} ${intent.dimensions[0]}s`);
    } else {
      parts.push('No data returned for the primary query.');
    }

    if (tables.changes) {
      const costChange = tables.changes.cost;
      parts.push(`Cost change: ${costChange.changePercent > 0 ? '+' : ''}${costChange.changePercent}%`);
      if (tables.changes.cpl?.changePercent) {
        parts.push(`CPL change: ${tables.changes.cpl.changePercent > 0 ? '+' : ''}${tables.changes.cpl.changePercent}%`);
      }
    }

    if (tables.anomalies?.length) {
      parts.push(`${tables.anomalies.length} anomalies detected`);
    }

    return parts.join('. ');
  }
}
