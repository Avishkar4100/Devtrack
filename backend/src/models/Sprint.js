const mongoose = require('mongoose');

const SprintSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    goal: {
      type: String,
    },
    status: {
      type: String,
      enum: ['future', 'active', 'completed'],
      default: 'future',
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    velocityPlanned: {
      type: Number,
      default: 0,
    },
    velocityActual: {
      type: Number,
      default: 0,
    },
    // Burndown data points: [{date, remaining}]
    burndownData: [
      {
        date: { type: Date },
        planned: { type: Number },
        actual: { type: Number },
      },
    ],
    jiraSprintId: { type: String },
    order: { type: Number, default: 0 },
    
    // Auto-closure tracking
    completedAt: { type: Date }, // When sprint was completed (manual or auto)
    autoClosedAt: { type: Date }, // When auto-closure was triggered
    wasAutoClosed: { type: Boolean, default: false }, // Whether it was auto-closed
    closureReason: { type: String }, // 'manual' | 'auto_expired' | 'auto_overdue'
    
    // Closure statistics
    storiesClosed: { type: Number, default: 0 },
    storiesIncomplete: { type: Number, default: 0 },
    storiesMoved: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Sprint', SprintSchema);
