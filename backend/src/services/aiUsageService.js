const AIUsageLog = require('../models/AIUsageLog');

const DEEPSEEK_PRICING = {
  'deepseek-v4-flash': {
    cacheHitPerMillion: 0.0028,
    cacheMissPerMillion: 0.14,
    outputPerMillion: 0.28,
  },
  'deepseek-v4-pro': {
    cacheHitPerMillion: 0.003625,
    cacheMissPerMillion: 0.435,
    outputPerMillion: 0.87,
  },
};

const normalizeModel = (model = '') => {
  const value = String(model || '').trim();
  if (value === 'deepseek-chat' || value === 'deepseek-reasoner') return 'deepseek-v4-flash';
  return value;
};

const extractUsage = (meta = {}) => ({
  promptTokens: Number(meta?.usage?.prompt_tokens || 0),
  completionTokens: Number(meta?.usage?.completion_tokens || 0),
  totalTokens: Number(meta?.usage?.total_tokens || 0),
  promptCacheHitTokens: Number(meta?.usage?.prompt_cache_hit_tokens || 0),
  promptCacheMissTokens: Number(meta?.usage?.prompt_cache_miss_tokens || 0),
});

const calculateCostUsd = ({ model, usage }) => {
  const pricing = DEEPSEEK_PRICING[normalizeModel(model)];
  if (!pricing) return 0;

  return (
    (usage.promptCacheHitTokens * pricing.cacheHitPerMillion) / 1_000_000
    + (usage.promptCacheMissTokens * pricing.cacheMissPerMillion) / 1_000_000
    + (usage.completionTokens * pricing.outputPerMillion) / 1_000_000
  );
};

const summarizeText = (value, maxChars = 1000) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...[truncated]`;
};

const recordAIUsage = async ({
  userId = null,
  provider = 'unknown',
  model = '',
  operation = 'unknown',
  requestSummary = '',
  responseSummary = '',
  requestMeta = {},
  responseMeta = {},
  latencyMs = 0,
  status = 'success',
  errorMessage = '',
}) => {
  const usage = extractUsage(responseMeta);
  const costUsd = calculateCostUsd({ model, usage });

  return AIUsageLog.create({
    user: userId || undefined,
    provider,
    model,
    operation,
    status,
    requestSummary: summarizeText(requestSummary, 2000),
    responseSummary: summarizeText(responseSummary, 2000),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    promptCacheHitTokens: usage.promptCacheHitTokens,
    promptCacheMissTokens: usage.promptCacheMissTokens,
    costUsd,
    latencyMs: Number(latencyMs || 0),
    requestMeta,
    responseMeta,
    errorMessage: summarizeText(errorMessage, 500),
  });
};

module.exports = {
  AIUsageLog,
  recordAIUsage,
  extractUsage,
  calculateCostUsd,
  normalizeModel,
};
