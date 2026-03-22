const mongoose = require('mongoose');

const StorySchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    epic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Epic',
    },
    type: {
      type: String,
      enum: ['story', 'task', 'bug', 'subtask'],
      default: 'story',
    },
    title: {
      type: String,
      required: [true, 'Story title is required'],
      trim: true,
    },
    description: {
      type: String,
    },
    storyKey: {
      type: String,
      trim: true,
    },
    acceptanceCriteria: [
      {
        criterion: { type: String },
        met: { type: Boolean, default: false },
      },
    ],
    status: {
      type: String,
      enum: ['draft', 'approved', 'to_do', 'in_progress', 'in_review', 'done', 'cancelled'],
      default: 'draft',
    },
    codeStatus: {
      type: String,
      enum: ['not_started', 'partial', 'done'],
      default: 'not_started',
    },
    priority: {
      type: String,
      enum: ['highest', 'high', 'medium', 'low', 'lowest'],
      default: 'medium',
    },
    storyPoints: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    sprint: {
      type: String,
      enum: ['S1', 'S2', 'S3', 'S4', 'backlog'],
      default: 'backlog',
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    parentStory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Story',
      default: null,
    },
    // Jira
    jiraIssueId: { type: String },
    jiraIssueKey: { type: String },
    pushedToJira: { type: Boolean, default: false },
    pushedAt: { type: Date },
    // GitHub traceability
    codeEvidence: [
      {
        filePath: { type: String },
        lineStart: { type: Number },
        lineEnd: { type: Number },
        commitSha: { type: String },
        commitMessage: { type: String },
        analyzedAt: { type: Date, default: Date.now },
      },
    ],
    lastAnalyzedAt: {
      type: Date,
    },
    aiGenerated: {
      type: Boolean,
      default: false,
    },
    generatedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
    },
    labels: [String],
    startDate: { type: Date },
    dueDate: { type: Date },
    estimatedHours: { type: Number, default: 0 },
    loggedHours: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    comments: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

StorySchema.index({ project: 1, status: 1 });
StorySchema.index({ epic: 1 });
StorySchema.index({ assignee: 1 });

module.exports = mongoose.model('Story', StorySchema);
