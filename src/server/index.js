import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import { v4 as uuid } from 'uuid';
import { Orchestrator } from '../services/orchestrator.js';
import { MemoryService } from '../services/memory.js';
import { MCPClient } from '../mcp/client.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ── Shared services (initialized once) ───────────────────────────────────────
let orchestrator;

async function boot() {
  // MongoDB is optional — use in-memory if MONGODB_URI is not set
  const mongoUri = process.env.MONGODB_URI;
  let useMongo = false;

  if (mongoUri) {
    try {
      const { connectDB } = await import('../models/db.js');
      await connectDB(mongoUri);
      useMongo = true;
    } catch (err) {
      console.warn('[boot] MongoDB connection failed, falling back to in-memory:', err.message);
    }
  } else {
    console.log('[boot] No MONGODB_URI set — using in-memory storage (data lost on restart)');
  }

  const mcp = new MCPClient({
    command: process.env.MCP_SERVER_COMMAND || 'npx',
    args: (process.env.MCP_SERVER_ARGS || '').split(','),
    env: {
      GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
      GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
      GOOGLE_ADS_REFRESH_TOKEN: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      GOOGLE_ADS_CUSTOMER_ID: process.env.GOOGLE_ADS_CUSTOMER_ID,
    },
  });
  await mcp.connect();

  const memory = new MemoryService({ useMongo });
  orchestrator = new Orchestrator({ mcp, memory, apiKey: process.env.ANTHROPIC_API_KEY });

  console.log('[boot] All services ready');
}

// ── REST endpoints ───────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Create a new session
app.post('/api/sessions', async (_req, res) => {
  const sessionId = uuid();
  res.json({ sessionId });
});

// Get conversation history for a session
app.get('/api/sessions/:sessionId/messages', async (req, res) => {
  try {
    const messages = await orchestrator.memory.getConversation(req.params.sessionId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Synchronous query endpoint (for simple integrations)
app.post('/api/query', async (req, res) => {
  const { sessionId, question, customerId } = req.body;
  if (!question) return res.status(400).json({ error: 'question is required' });

  try {
    const result = await orchestrator.handleQuery({ sessionId: sessionId || uuid(), question, customerId });
    res.json(result);
  } catch (err) {
    console.error('[api/query]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── WebSocket (streaming responses) ─────────────────────────────────────────

wss.on('connection', (ws) => {
  const connectionId = uuid();
  console.log(`[ws] connected: ${connectionId}`);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'invalid JSON' }));
      return;
    }

    if (msg.type === 'query') {
      const { sessionId, question, customerId } = msg;
      const requestId = uuid();

      // Acknowledge receipt
      ws.send(JSON.stringify({ type: 'ack', requestId }));

      try {
        // Stream status updates
        const send = (type, payload) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type, requestId, ...payload }));
          }
        };

        const result = await orchestrator.handleQuery({
          sessionId: sessionId || connectionId,
          question,
          customerId,
          onStatus: (status) => send('status', { status }),
        });

        send('result', { data: result });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', requestId, error: err.message }));
      }
    }
  });

  ws.on('close', () => console.log(`[ws] disconnected: ${connectionId}`));
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

boot()
  .then(() => {
    server.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('[boot] fatal:', err);
    process.exit(1);
  });
