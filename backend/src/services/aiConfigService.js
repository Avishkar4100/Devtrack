const AIConfig = require('../models/AIConfig');

const DEEPSEEK_OFFICIAL_MIN_MAX_TOKENS = 120000;

const getActiveAIConfigPayload = async () => {
  const cfg = await AIConfig.findOne({ isActive: true }).lean();
  if (!cfg) return null;
  const maxTokens = cfg.provider === 'deepseek_api'
    ? Math.max(Number(cfg.maxTokens || 0), DEEPSEEK_OFFICIAL_MIN_MAX_TOKENS)
    : cfg.maxTokens;

  return {
    provider: cfg.provider,
    openrouterKeyName: cfg.openrouterKeyName,
    openrouterModel: cfg.openrouterModel,
    deepseekUrl: cfg.deepseekUrl,
    deepseekModel: cfg.deepseekModel,
    deepseekThinking: cfg.deepseekThinking,
    deepseekReasoningEffort: cfg.deepseekReasoningEffort,
    temperature: cfg.temperature,
    maxTokens,
    manualBridgeTimeoutSeconds: cfg.manualBridgeTimeoutSeconds,
  };
};

module.exports = {
  getActiveAIConfigPayload,
};
