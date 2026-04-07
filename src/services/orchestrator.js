import { QueryUnderstandingLayer } from '../layers/query-understanding.js';
import { GAQLBuilder } from '../layers/gaql-builder.js';
import { DataProcessor } from '../layers/data-processor.js';
import { AnalysisLayer } from '../layers/analysis.js';
import { CONVERSATION_CONTEXT_WINDOW } from '../../config/defaults.js';

/**
 * Orchestrator — the single entry-point that wires every layer together.
 *
 * Flow:
 *   user question
 *     → QueryUnderstandingLayer  (NL → structured intent)
 *     → GAQLBuilder              (intent → GAQL queries)
 *     → MCPClient.executeQuery   (GAQL → raw rows)
 *     → DataProcessor            (raw rows → aggregated metrics, comparisons, anomalies)
 *     → AnalysisLayer            (metrics + intent → Claude-generated insight)
 *     → response returned to caller
 *
 * Memory is read before the first step (context) and written after the last (persistence).
 */
export class Orchestrator {
  constructor({ mcp, memory, apiKey }) {
    this.mcp = mcp;
    this.memory = memory;
    this.queryLayer = new QueryUnderstandingLayer(apiKey);
    this.gaqlBuilder = new GAQLBuilder();
    this.dataProcessor = new DataProcessor();
    this.analysisLayer = new AnalysisLayer(apiKey);
  }

  async handleQuery({ sessionId, question, customerId, onStatus }) {
    const status = (msg) => onStatus && onStatus(msg);

    // 1. Load conversation context
    status('Loading conversation context…');
    const history = await this.memory.getConversation(sessionId, CONVERSATION_CONTEXT_WINDOW);

    // 2. Understand the query
    status('Understanding your question…');
    const intent = await this.queryLayer.parse(question, history);

    // 3. Build GAQL queries from intent
    status('Building data queries…');
    const queries = this.gaqlBuilder.build(intent);

    // 4. Execute queries via MCP
    status('Fetching data from Google Ads…');
    const rawResults = {};
    for (const [key, gaql] of Object.entries(queries)) {
      try {
        rawResults[key] = await this.mcp.executeQuery(gaql, customerId);
      } catch (err) {
        rawResults[key] = { error: err.message, query: gaql };
      }
    }

    // 5. Process data
    status('Processing and analyzing data…');
    const processed = this.dataProcessor.process(rawResults, intent);

    // 6. Generate insight via Claude
    status('Generating insights…');
    const analysis = await this.analysisLayer.analyze({
      question,
      intent,
      data: processed,
      history,
    });

    // 7. Persist to memory
    await this.memory.saveInteraction(sessionId, {
      question,
      intent,
      queriesExecuted: Object.keys(queries),
      dataSummary: processed.summary,
      response: analysis,
    });

    return {
      answer: analysis.answer,
      insights: analysis.insights,
      recommendations: analysis.recommendations,
      data: processed.tables,
      meta: {
        intent,
        queriesRun: Object.keys(queries).length,
        rowsFetched: processed.totalRows,
      },
    };
  }
}
