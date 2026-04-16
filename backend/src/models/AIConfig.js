const mongoose = require('mongoose');

const AIConfigSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: 'Default AI Config',
      maxlength: [80, 'AI config name cannot exceed 80 characters'],
    },
    provider: {
      type: String,
      enum: ['openrouter', 'deepseek_local', 'manual_bridge'],
      default: 'openrouter',
    },
    openrouterKeyName: {
      type: String,
      default: 'OPENROUTER_API_KEY',
    },
    openrouterModel: {
      type: String,
      default: 'google/gemma-3-27b-it:free',
    },
    deepseekUrl: {
      type: String,
      default: '',
    },
    deepseekModel: {
      type: String,
      default: 'deepseek-chat',
    },
    temperature: {
      type: Number,
      default: 0.2,
      min: 0,
      max: 2,
    },
    maxTokens: {
      type: Number,
      default: 4096,
      min: 128,
      max: 32768,
    },
    manualBridgeTimeoutSeconds: {
      type: Number,
      default: 1800,
      min: 30,
      max: 7200,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

AIConfigSchema.index({ isActive: 1 });

module.exports = mongoose.model('AIConfig', AIConfigSchema);
