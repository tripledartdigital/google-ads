import { spawn } from 'child_process';

/**
 * MCP Client — manages a long-lived child process running the Google Ads MCP server.
 *
 * Communication uses JSON-RPC over stdio (the MCP standard transport).
 * The server exposes tools like `google_ads_query` which accept GAQL strings.
 */
export class MCPClient {
  constructor({ command, args, env }) {
    this.command = command;
    this.args = args.filter(Boolean);
    this.env = env;
    this.process = null;
    this.requestId = 0;
    this.pending = new Map(); // id → { resolve, reject }
    this.buffer = '';
    this.tools = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout.on('data', (chunk) => this.onData(chunk));
      this.process.stderr.on('data', (chunk) => {
        console.error(`[mcp stderr] ${chunk.toString()}`);
      });
      this.process.on('error', (err) => {
        console.error('[mcp] process error:', err);
        reject(err);
      });
      this.process.on('close', (code) => {
        console.log(`[mcp] process exited with code ${code}`);
      });

      // Initialize the MCP session
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'google-ads-nlp', version: '1.0.0' },
      })
        .then((result) => {
          console.log('[mcp] initialized:', result?.serverInfo?.name);
          // Send initialized notification
          this.sendNotification('notifications/initialized', {});
          return this.listTools();
        })
        .then((toolsResult) => {
          this.tools = toolsResult?.tools || [];
          console.log(`[mcp] ${this.tools.length} tools available:`, this.tools.map(t => t.name));
          resolve();
        })
        .catch(reject);
    });
  }

  async listTools() {
    return this.sendRequest('tools/list', {});
  }

  async executeQuery(gaql, customerId) {
    // Find the query tool (common names: google_ads_query, query, search)
    const queryTool = this.tools.find(t =>
      t.name.includes('query') || t.name.includes('search') || t.name.includes('gaql')
    );

    const toolName = queryTool?.name || 'google_ads_query';

    const args = { query: gaql };
    if (customerId) {
      args.customer_id = customerId.replace(/-/g, '');
    }

    const result = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });

    // MCP tool results come as content array
    if (result?.content) {
      const textContent = result.content.find(c => c.type === 'text');
      if (textContent) {
        try {
          return JSON.parse(textContent.text);
        } catch {
          return textContent.text;
        }
      }
    }

    return result;
  }

  sendRequest(method, params) {
    const id = ++this.requestId;
    const message = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, timer: setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after 30s`));
      }, 30_000) });

      this.write(message);
    });
  }

  sendNotification(method, params) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  write(obj) {
    const body = JSON.stringify(obj);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  onData(chunk) {
    this.buffer += chunk.toString();

    // Parse JSON-RPC messages from the buffer (Content-Length framing)
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const bodyLength = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.buffer.length < bodyStart + bodyLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + bodyLength);
      this.buffer = this.buffer.slice(bodyStart + bodyLength);

      try {
        const msg = JSON.parse(body);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[mcp] failed to parse message:', err);
      }
    }
  }

  handleMessage(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);

      if (msg.error) {
        reject(new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`));
      } else {
        resolve(msg.result);
      }
    }
  }

  async disconnect() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
