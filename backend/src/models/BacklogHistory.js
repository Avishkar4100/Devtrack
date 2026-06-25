const mongoose = require('mongoose');

const BacklogHistorySchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    moduleName: {
      type: String,
      trim: true,
    },
    payload: {
      epics: { type: Array, default: [] },
      stories: { type: Array, default: [] },
      tasks: { type: Array, default: [] },
      subtasks: { type: Array, default: [] },
    },
    planningMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    selectedPlanningPaths: {
      type: Array,
      default: [],
    },
    source: {
      type: String,
      enum: ['generated', 'manual'],
      default: 'generated',
    },
  },
  { timestamps: true }
);

BacklogHistorySchema.index({ project: 1, createdAt: -1 });

module.exports = mongoose.model('BacklogHistory', BacklogHistorySchema);
