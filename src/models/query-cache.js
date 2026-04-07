import mongoose from 'mongoose';
import { CACHE_TTL_SECONDS } from '../../config/defaults.js';

const queryCacheSchema = new mongoose.Schema({
  queryHash: { type: String, required: true, unique: true },
  gaql: { type: String, required: true },
  customerId: { type: String, required: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true },
  rowCount: { type: Number },
  createdAt: { type: Date, default: Date.now, expires: CACHE_TTL_SECONDS },
});

export const QueryCache = mongoose.model('QueryCache', queryCacheSchema);
