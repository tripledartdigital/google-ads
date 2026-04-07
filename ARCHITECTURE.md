# Google Ads NLP Analytics — System Architecture

## Overview

A standalone web application where users ask natural language questions about their Google Ads account and receive data-driven, actionable answers. No Slack, no external tools — the entire experience lives inside this app.

---

## System Flow

```
User types question
       │
       ▼
┌─────────────────┐
│  Frontend (React)│  ← Chat UI with WebSocket connection
└────────┬────────┘
         │ WebSocket
         ▼
┌─────────────────┐
│  Express Server  │  ← HTTP + WS, session management
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Orchestrator   │  ← Wires all layers together, streams status updates
└────────┬────────┘
         │
    ┌────┼────┬──────────┬──────────┐
    ▼    ▼    ▼          ▼          ▼
 Memory  QU  GAQL     DataProc   Analysis
 Layer  Layer Builder   Layer     Layer
    │         │                     │
    │         ▼                     │
    │    ┌─────────┐                │
    │    │MCP Client│               │
    │    │(Google   │               │
    │    │ Ads)     │               │
    │    └─────────┘                │
    │                               │
    ▼                               ▼
 MongoDB                     Claude API
```

### Step-by-step flow:

1. **User sends question** via WebSocket → Express server
2. **Memory Layer** loads past conversation for context
3. **Query Understanding Layer** (Claude) converts NL → structured JSON intent
4. **GAQL Builder** converts intent → one or more GAQL queries
5. **MCP Client** executes GAQL against Google Ads via stdio JSON-RPC
6. **Data Processor** transforms raw rows → aggregated metrics, comparisons, anomalies
7. **Analysis Layer** (Claude) takes processed data + intent → generates answer, insights, recommendations
8. **Memory Layer** saves the interaction for future context
9. **Response** streamed back to frontend via WebSocket

---

## Tech Stack Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Backend | Node.js + Express | Native MCP stdio support, excellent WebSocket perf, single language with frontend |
| Database | MongoDB | Document model matches variable intent/data shapes; embedded message arrays; native TTL indexes for cache; no migrations needed |
| Frontend | React + Vite | Fast dev cycle, minimal deps, component model fits chat UI |
| AI | Claude (Sonnet) | Two-call pattern: fast intent parsing + deep analysis |
| Data | Google Ads MCP | Standard MCP protocol over stdio, GAQL for queries |

### Why MongoDB over Supabase/Postgres

1. **Schema flexibility** — Intent objects vary per query type (diagnostic has anomalies, comparison has change deltas, audit has search terms). Mongo stores these as native documents without JSON columns or ALTER TABLE.
2. **Embedded arrays** — Conversation messages are a sub-document array on the session document. One read fetches the whole conversation. In Postgres this would be a JOIN across two tables.
3. **TTL indexes** — Query cache documents auto-expire after 5 minutes via `expires` on the schema. No cron job, no cleanup query.
4. **Operational simplicity** — Single data store. No connection pooling issues, no ORM mismatch.
5. **Horizontal scaling** — Shard on `sessionId` when needed. No cross-shard JOINs because conversations are self-contained documents.

---

## Layer Details

### 1. Query Understanding Layer (`src/layers/query-understanding.js`)

Converts natural language → structured JSON intent using Claude.

**Input:** `"why did CPL increase last week?"`

**Output:**
```json
{
  "date_range": "last_week",
  "comparison_range": null,
  "metrics": ["cost", "conversions", "cpl"],
  "dimensions": ["campaign", "date"],
  "analysis_type": "diagnostic",
  "filters": { "campaign_status": "ENABLED" },
  "sort_by": "cost",
  "sort_order": "desc",
  "limit": null,
  "follow_up_context": null
}
```

**Key behaviors:**
- Receives last 6 messages of conversation history for follow-up handling
- Defaults: `last_30_days`, `["campaign"]` dimension, always includes cost+conversions
- "Why" → diagnostic (adds date dimension for trend detection)
- "What should I" → recommendation
- "Wasting/losing" → audit

### 2. GAQL Builder (`src/layers/gaql-builder.js`)

Converts intent → one or more GAQL queries.

**Templates generated automatically based on intent:**

| Scenario | Queries Generated |
|----------|-------------------|
| Simple overview | 1 query: campaign metrics for date range |
| Diagnostic | 2 queries: primary + daily_trend (date dimension added) |
| Audit | 2 queries: primary + search_terms (top 50 by cost) |
| Comparison | 2 queries: primary + comparison period |
| Diagnostic + comparison | 3 queries: primary + daily_trend + comparison |

**Example GAQL output:**
```sql
SELECT campaign.id, campaign.name, campaign.status,
       metrics.cost_micros, metrics.clicks, metrics.conversions,
       metrics.conversions_value
FROM campaign
WHERE segments.date DURING LAST_BUSINESS_WEEK
  AND campaign.status = 'ENABLED'
ORDER BY metrics.cost_micros DESC
LIMIT 10000
```

**Resource selection logic:**
- `search_term` dimension → `search_term_view`
- `keyword` dimension → `keyword_view`
- `geo` dimension → `geographic_view`
- `ad_group` dimension → `ad_group`
- Default → `campaign`

### 3. Data Processor (`src/layers/data-processor.js`)

Transforms raw MCP results into analysis-ready data.

**Capabilities:**

| Feature | How |
|---------|-----|
| Metric computation | CPL = cost/conversions, CVR = conversions/clicks, ROAS = value/cost |
| Period comparison | Aggregates both periods, computes absolute + % change |
| Anomaly detection | Z-score on daily data, flags |z| > 2 as spike/drop |
| Summarization | Text summary of totals for Claude context |

**Anomaly detection algorithm:**
1. Compute mean and standard deviation per metric across all days
2. Calculate z-score for each day: `(value - mean) / stdDev`
3. Flag any day with `|z-score| > 2` as anomalous
4. Sort by severity (highest |z-score| first)
5. Return: date, metric, value, mean, z-score, direction (spike/drop), campaign

### 4. Analysis Layer (`src/layers/analysis.js`)

Sends processed data + intent to Claude for final analysis.

**Prompt structure per analysis type:**

| Type | Claude focuses on |
|------|-------------------|
| `overview` | Performance summary, lead with most important metric changes |
| `diagnostic` | Root cause: which campaigns, when the shift happened, anomalies |
| `recommendation` | Quick wins → budget reallocation → bid adjustments → structural |
| `audit` | Zero-conversion spend, irrelevant search terms, impression share loss |
| `comparison` | What improved, what declined, drivers of change |
| `anomaly` | What happened, when, likely causes |

**Output format:**
```json
{
  "answer": "Direct 2-4 sentence answer with specific numbers",
  "insights": ["Data-backed observation 1", "..."],
  "recommendations": ["Specific action 1", "..."]
}
```

**Non-negotiable rules in the prompt:**
- Every statement must reference specific campaigns, numbers, or trends
- Never give generic advice
- Recommendations must be actionable: "Pause keyword X in campaign Y"
- If data is insufficient, say so

### 5. Memory Layer (`src/services/memory.js` + `src/models/`)

**Schema:**

```
Conversation {
  sessionId: string (indexed)
  customerId: string (indexed)
  messages: [{
    role: "user" | "assistant"
    content: string
    intent: Mixed        // structured intent for assistant messages
    dataSummary: Mixed   // aggregated data summary
    timestamp: Date
  }]
  createdAt: Date
  updatedAt: Date
}

QueryCache {
  queryHash: string (unique, SHA-256 of customerId:gaql)
  gaql: string
  customerId: string
  result: Mixed
  rowCount: number
  createdAt: Date (TTL: 300 seconds)
}
```

**How memory improves responses:**
1. **Follow-up queries** — "What about last month?" uses conversation context to infer the same metrics/campaigns from the previous question
2. **Intent continuity** — Previous intents are summarized in the Claude prompt, so "drill into campaign X" works without restating everything
3. **Caching** — Identical GAQL queries within 5 minutes hit cache instead of MCP

### 6. MCP Client (`src/mcp/client.js`)

Manages a long-lived Google Ads MCP server process via stdio.

**Protocol:** JSON-RPC 2.0 with Content-Length framing (MCP standard).

**Lifecycle:**
1. `spawn` the MCP server process
2. Send `initialize` → receive capabilities
3. Send `notifications/initialized`
4. `tools/list` → discover available tools
5. For each query: `tools/call` with tool name + GAQL + customer_id
6. Parse Content-Length framed responses, resolve pending promises

**Error handling:**
- 30-second timeout per request
- Stderr logging for MCP server errors
- Graceful reconnection on process exit

---

## Edge Cases

| Edge Case | Handling |
|-----------|----------|
| **No data returned** | Data processor returns empty tables; analysis prompt explicitly tells Claude "no data for this range" |
| **No conversions** | CPL/CVR/ROAS compute as `null`; analysis prompt instructs Claude to note insufficient conversion data |
| **Low sample size** | Anomaly detection skips metrics with < 3 data points; analysis notes the limitation |
| **Conflicting signals** | Claude's diagnostic prompt asks it to note when metrics conflict (e.g., cost down but CPL up) |
| **MCP query failure** | Error captured per-query; other queries still execute; error surfaced in response |
| **Very large accounts** | MAX_ROWS_PER_QUERY = 10,000; data table shows top 20 in prompt, top 50 in UI |
| **Follow-up ambiguity** | Query understanding receives last 6 messages; if ambiguous, defaults are sensible |

---

## Scalability Strategy

| Concern | Solution |
|---------|----------|
| Large accounts (100k+ keywords) | Queries are pre-filtered (ENABLED status, date range), sorted, and limited. Data processor handles aggregation server-side. |
| Query latency | MongoDB TTL cache (5 min) avoids re-fetching unchanged data. Intent parsing uses Sonnet (fast). |
| Concurrent users | WebSocket per connection, Express scales horizontally. MongoDB sessions are independent documents. |
| Prompt size | Data processor sends top 20 rows to Claude, not raw data. Summary statistics always included. |
| Memory growth | Conversations are per-session documents. Old sessions can be archived with a TTL index on `updatedAt`. |

---

## File Structure

```
google-ads/
├── config/
│   └── defaults.js              # All constants: date ranges, metrics, dimensions
├── src/
│   ├── server/
│   │   └── index.js             # Express + WebSocket server, routes
│   ├── services/
│   │   ├── orchestrator.js      # Main pipeline: question → answer
│   │   └── memory.js            # Conversation persistence + query cache
│   ├── layers/
│   │   ├── query-understanding.js  # NL → structured intent (Claude)
│   │   ├── gaql-builder.js         # Intent → GAQL queries
│   │   ├── data-processor.js       # Raw data → metrics, comparisons, anomalies
│   │   └── analysis.js             # Data + intent → insights (Claude)
│   ├── mcp/
│   │   └── client.js            # MCP stdio client for Google Ads
│   └── models/
│       ├── db.js                # MongoDB connection
│       ├── conversation.js      # Conversation schema
│       └── query-cache.js       # GAQL result cache schema
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── App.jsx          # Main app layout
│   │   │   ├── ChatWindow.jsx   # Message list + input
│   │   │   ├── MessageBubble.jsx # Individual message rendering
│   │   │   ├── DataTable.jsx    # Expandable data table
│   │   │   └── Sidebar.jsx      # Session list
│   │   ├── hooks/
│   │   │   └── useWebSocket.js  # WS connection + message state
│   │   └── styles/
│   │       └── index.css        # Full dark theme
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── .env.example
├── .gitignore
├── package.json
└── ARCHITECTURE.md
```

---

## Example Query Traces

### "Why did CPL increase last week?"

```
Intent: { date_range: "last_week", metrics: ["cost","conversions","cpl"],
          dimensions: ["campaign","date"], analysis_type: "diagnostic" }

Queries:
  primary:     SELECT ... FROM campaign WHERE ... DURING LAST_BUSINESS_WEEK
  daily_trend: SELECT ... FROM campaign WHERE ... DURING LAST_BUSINESS_WEEK  (with segments.date)

Processing:
  - Aggregates cost/conversions per campaign
  - Computes CPL per campaign
  - Runs anomaly detection on daily cost/conversions/cpl
  - Flags: "Wednesday cost spiked 2.4σ above mean in campaign Brand"

Analysis prompt includes: summary, per-campaign table, anomaly list
Claude response: "CPL increased 23% to $45.20, driven primarily by Campaign 'Brand'
  where cost rose 40% on Wednesday due to a CPC spike while conversions stayed flat..."
```

### "Which campaigns are wasting spend?"

```
Intent: { date_range: "last_30_days", metrics: ["cost","conversions","cpl","cvr"],
          dimensions: ["campaign"], analysis_type: "audit",
          sort_by: "cost", sort_order: "desc" }

Queries:
  primary:      SELECT ... FROM campaign ... ORDER BY metrics.cost_micros DESC
  search_terms: SELECT ... FROM search_term_view ... ORDER BY metrics.cost_micros DESC LIMIT 50

Processing:
  - Flags campaigns with cost > $0 and conversions = 0
  - Flags campaigns with CPL > 3x account average
  - Identifies search terms with high cost, zero conversions

Claude response: "3 campaigns are wasting spend totaling $2,340:
  1. 'Display - Generic' — $1,200 spent, 0 conversions
  2. 'Search - Competitor' — $890, 1 conversion at $890 CPL (account avg is $45)
  Recommendation: Pause 'Display - Generic' immediately, add negative keywords..."
```

### "Performance this month vs last month"

```
Intent: { date_range: "this_month", comparison_range: "last_month",
          metrics: ["cost","clicks","conversions","cpl","roas"],
          dimensions: ["campaign"], analysis_type: "comparison" }

Queries:
  primary:    SELECT ... WHERE ... DURING THIS_MONTH
  comparison: SELECT ... WHERE ... DURING LAST_MONTH

Processing:
  - Aggregates both periods
  - Computes: cost +12%, conversions +5%, CPL +6.7%, ROAS -8%

Claude response: "Month-over-month: spend increased 12% to $15,400 while conversions
  grew only 5%, pushing CPL up 6.7% to $48.30. ROAS declined 8% to 3.2x..."
```
