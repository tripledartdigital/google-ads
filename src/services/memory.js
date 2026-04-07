import { Conversation } from '../models/conversation.js';
import { QueryCache } from '../models/query-cache.js';
import crypto from 'crypto';

/**
 * Memory service — persists conversations and caches query results.
 *
 * Why MongoDB over Supabase/Postgres:
 *   1. Schema flexibility: intent objects and data summaries vary per query type.
 *      Mongo's document model stores these natively without JSON columns or migrations.
 *   2. Embedded arrays: conversation messages are naturally a sub-document array,
 *      which is more efficient than a separate messages table with JOINs.
 *   3. TTL indexes: Mongo natively expires cache documents — no cron needed.
 *   4. Operational simplicity: single data store, no ORM mismatch.
 *   5. Horizontal scaling: if accounts grow large, Mongo shards on sessionId trivially.
 */
export class MemoryService {
  /**
   * Get recent conversation messages for a session.
   */
  async getConversation(sessionId, limit = 10) {
    const convo = await Conversation.findOne({ sessionId }).lean();
    if (!convo) return [];
    return convo.messages.slice(-limit);
  }

  /**
   * Save a user question + assistant response as two messages in the conversation.
   */
  async saveInteraction(sessionId, { question, intent, dataSummary, response }) {
    const userMsg = {
      role: 'user',
      content: question,
    };

    const assistantMsg = {
      role: 'assistant',
      content: response.answer,
      intent,
      dataSummary,
    };

    await Conversation.findOneAndUpdate(
      { sessionId },
      {
        $push: { messages: { $each: [userMsg, assistantMsg] } },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  }

  /**
   * Check cache for a GAQL query result.
   */
  async getCachedQuery(gaql, customerId) {
    const hash = this.hashQuery(gaql, customerId);
    const cached = await QueryCache.findOne({ queryHash: hash }).lean();
    return cached?.result || null;
  }

  /**
   * Store a GAQL query result in cache.
   */
  async cacheQuery(gaql, customerId, result) {
    const hash = this.hashQuery(gaql, customerId);
    await QueryCache.findOneAndUpdate(
      { queryHash: hash },
      {
        gaql,
        customerId,
        result,
        rowCount: Array.isArray(result) ? result.length : 0,
        createdAt: new Date(),
      },
      { upsert: true }
    );
  }

  hashQuery(gaql, customerId) {
    return crypto.createHash('sha256').update(`${customerId}:${gaql}`).digest('hex');
  }
}
