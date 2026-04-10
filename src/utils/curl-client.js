import { execSync } from 'child_process';

/**
 * Fallback Anthropic client that uses curl instead of node-fetch.
 * Used in sandbox environments where Node.js can't make outbound HTTPS calls
 * but curl can. On a normal machine, the standard SDK works fine.
 */
export class CurlAnthropicClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async createMessage({ model, max_tokens, system, messages }) {
    const body = JSON.stringify({
      model,
      max_tokens,
      ...(system ? { system } : {}),
      messages,
    });

    // Escape single quotes in the JSON body for shell safety
    const escapedBody = body.replace(/'/g, "'\\''");

    const cmd = `curl -s --max-time 120 -X POST https://api.anthropic.com/v1/messages \
      -H 'content-type: application/json' \
      -H 'x-api-key: ${this.apiKey}' \
      -H 'anthropic-version: 2023-06-01' \
      -d '${escapedBody}'`;

    const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(result);

    if (parsed.error) {
      throw new Error(`Anthropic API error: ${parsed.error.message}`);
    }

    return parsed;
  }
}
