const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      enum: ['pdf', 'docx', 'txt', 'doc', 'md'],
      required: true,
    },
    filePath: {
      type: String,
    },
    fileSize: {
      type: Number,
    },
    status: {
      type: String,
      enum: ['uploaded', 'validating', 'parsing', 'embedding', 'extracting', 'processed', 'failed'],
      default: 'uploaded',
    },
    ingestionStatus: {
      chunks: { type: Number, default: 0 },
      embeddings: { type: Number, default: 0 },
      processingTime: { type: Number, default: 0 }, // ms
      errorMessage: { type: String },
      errorStage: { type: String }, // Stage where error occurred
      detectedFileType: { type: String }, // Actual detected file type
      detectionMethod: { type: String }, // 'magic_number' or 'extension'
      textLength: { type: Number, default: 0 },
      wordCount: { type: Number, default: 0 },
      validationPassed: { type: Boolean, default: false },
      warnings: [String], // Array of warning messages
    },
    extractedText: {
      type: String,
      select: false,
    },
    extractedRequirements: {
      functional: [String],
      nonFunctional: [String],
      modules: [String],
      actors: [String],
      extractedAt: Date,
      extractionVersion: { type: Number, default: 1 },
      lastStrategy: { type: String, default: 'standard' },
      quality: {
        functionalCount: { type: Number, default: 0 },
        nonFunctionalCount: { type: Number, default: 0 },
        moduleCount: { type: Number, default: 0 },
        actorCount: { type: Number, default: 0 },
      },
      validationWarnings: [String],
      validationScore: { type: Number, default: 0 }, // 0-100 score
    },
    version: {
      type: Number,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    vectorNamespace: {
      type: String,
    },
    requirementMap: {
      items: [
        {
          id: { type: String, trim: true },
          title: { type: String, trim: true },
          module: { type: String, trim: true },
          status: { type: String, default: 'draft' },
        },
      ],
      source: { type: String, default: 'generated' },
      generatedAt: { type: Date },
      version: { type: Number, default: 1 },
    },
    requirementGraph: {
      items: [
        {
          requirement_id: { type: String, trim: true },
          title: { type: String, trim: true },
          module: { type: String, trim: true },
          type: { type: String, enum: ['functional', 'non_functional'], default: 'functional' },
          dependencies: [{ type: String, trim: true }],
          chunk_refs: [
            {
              chunk_id: { type: String, trim: true },
              chunk_index: { type: Number },
              namespace: { type: String, trim: true },
            },
          ],
          section_refs: [
            {
              section_name: { type: String, trim: true },
              chunk_index: { type: Number },
              chunk_id: { type: String, trim: true },
            },
          ],
        },
      ],
      source: { type: String, default: 'ingestion' },
      generatedAt: { type: Date },
      version: { type: Number, default: 1 },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Document', DocumentSchema);
