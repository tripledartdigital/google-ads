import crypto from 'crypto';
import { CACHE_TTL_SECONDS } from '../../config/defaults.js';

/**
 * Memory service — persists conversations and caches query results.
 *
 * Supports two backends:
 *   1. MongoDB (production) — set MONGODB_URI in .env
 *   2. In-memory (development) — works with zero setup
 *
 * The in-memory backend stores everything in plain Maps. Data is lost on
 * restart, but that's fine for local development and testing.
 */
export class MemoryService {
  constructor({ useMongo = false } = {}) {
    this.useMongo = useMongo;
    // In-memory stores (used when MongoDB is not available)
    this.conversations = new Map(); // sessionId → { messages: [] }
    this.queryCache = new Map();    // hash → { result, createdAt }
  }

  async getConversation(sessionId, limit = 10) {
    if (this.useMongo) {
      const { Conversation } = await import('../models/conversation.js');
      const convo = await Conversation.findOne({ sessionId }).lean();
      if (!convo) return [];
      return convo.messages.slice(-limit);
    }

    const convo = this.conversations.get(sessionId);
    if (!convo) return [];
    return convo.messages.slice(-limit);
  }

  async saveInteraction(sessionId, { question, intent, dataSummary, response }) {
    const userMsg = { role: 'user', content: question, timestamp: new Date() };
    const assistantMsg = { role: 'assistant', content: response.answer, intent, dataSummary, timestamp: new Date() };

    if (this.useMongo) {
      const { Conversation } = await import('../models/conversation.js');
      await Conversation.findOneAndUpdate(
        { sessionId },
        {
          $push: { messages: { $each: [userMsg, assistantMsg] } },
          $set: { updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
      return;
    }

    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, { messages: [] });
    }
    this.conversations.get(sessionId).messages.push(userMsg, assistantMsg);
  }

  async getCachedQuery(gaql, customerId) {
    const hash = this.hashQuery(gaql, customerId);

    if (this.useMongo) {
      const { QueryCache } = await import('../models/query-cache.js');
      const cached = await QueryCache.findOne({ queryHash: hash }).lean();
      return cached?.result || null;
    }

    const cached = this.queryCache.get(hash);
    if (!cached) return null;
    // Check TTL
    if (Date.now() - cached.createdAt > CACHE_TTL_SECONDS * 1000) {
      this.queryCache.delete(hash);
      return null;
    }
    return cached.result;
  }

  async cacheQuery(gaql, customerId, result) {
    const hash = this.hashQuery(gaql, customerId);

    if (this.useMongo) {
      const { QueryCache } = await import('../models/query-cache.js');
      await QueryCache.findOneAndUpdate(
        { queryHash: hash },
        { gaql, customerId, result, rowCount: Array.isArray(result) ? result.length : 0, createdAt: new Date() },
        { upsert: true }
      );
      return;
    }

    this.queryCache.set(hash, { result, createdAt: Date.now() });
  }

  hashQuery(gaql, customerId) {
    return crypto.createHash('sha256').update(`${customerId}:${gaql}`).digest('hex');
  }
}
