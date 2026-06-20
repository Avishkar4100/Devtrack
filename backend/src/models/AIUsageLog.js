const mongoose = require('mongoose');

const AIUsageLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    provider: {
      type: String,
      required: true,
      enum: ['openrouter', 'deepseek_local', 'deepseek_api', 'manual_bridge'],
    },
    model: {
      type: String,
      default: '',
    },
    operation: {
      type: String,
      default: 'unknown',
      index: true,
    },
    status: {
      type: String,
      enum: ['success', 'error'],
      default: 'success',
    },
    requestSummary: {
      type: String,
      default: '',
    },
    responseSummary: {
      type: String,
      default: '',
    },
    promptTokens: {
      type: Number,
      default: 0,
    },
    completionTokens: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    promptCacheHitTokens: {
      type: Number,
      default: 0,
    },
    promptCacheMissTokens: {
      type: Number,
      default: 0,
    },
    costUsd: {
      type: Number,
      default: 0,
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
    requestMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    responseMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    errorMessage: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

AIUsageLogSchema.index({ createdAt: -1 });
AIUsageLogSchema.index({ provider: 1, createdAt: -1 });
AIUsageLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AIUsageLog', AIUsageLogSchema);
