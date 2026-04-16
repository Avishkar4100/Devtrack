const AIConfig = require('../models/AIConfig');

const getActiveAIConfigPayload = async () => {
  const cfg = await AIConfig.findOne({ isActive: true }).lean();
  if (!cfg) return null;

  return {
    provider: cfg.provider,
    openrouterKeyName: cfg.openrouterKeyName,
    openrouterModel: cfg.openrouterModel,
    deepseekUrl: cfg.deepseekUrl,
    deepseekModel: cfg.deepseekModel,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    manualBridgeTimeoutSeconds: cfg.manualBridgeTimeoutSeconds,
  };
};

module.exports = {
  getActiveAIConfigPayload,
};
