const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: [100, 'Project name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    key: {
      type: String,
      required: [true, 'Project key is required'],
      uppercase: true,
      trim: true,
      maxlength: [10, 'Project key cannot exceed 10 characters'],
      match: [/^[A-Z0-9]+$/, 'Project key must be alphanumeric uppercase'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        role: {
          type: String,
          enum: ['scrum_master', 'manager'],
          default: 'manager',
        },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      enum: ['planning', 'active', 'paused', 'completed', 'archived'],
      default: 'planning',
    },
    budget: {
      type: Number,
      default: 0,
    },
    deadline: {
      type: Date,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    technology: {
      type: String,
    },
    // Jira integration
    jiraProjectKey: {
      type: String,
    },
    jiraProjectId: {
      type: String,
    },
    jiraConnected: {
      type: Boolean,
      default: false,
    },
    // GitHub integration
    githubRepo: {
      type: String, // format: owner/repo
    },
    githubBranch: {
      type: String,
      default: 'main',
    },
    githubConnected: {
      type: Boolean,
      default: false,
    },
    githubWebhookId: {
      type: String,
    },
    // Progress tracking
    completionPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    totalStories: { type: Number, default: 0 },
    completedStories: { type: Number, default: 0 },
    inProgressStories: { type: Number, default: 0 },
    color: {
      type: String,
      default: '#6366f1',
    },
    tags: [String],
    // Cached AI delivery snapshot
    deliverySnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    deliverySnapshotAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for members count
ProjectSchema.virtual('memberCount').get(function () {
  return this.members.length + 1;
});

// Unique key per owner
ProjectSchema.index({ key: 1, owner: 1 }, { unique: true });

module.exports = mongoose.model('Project', ProjectSchema);
