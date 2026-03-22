const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    action: {
      type: String,
      required: true,
      enum: [
        'document_uploaded',
        'document_ingested',
        'stories_generated',
        'story_approved',
        'story_edited',
        'story_deleted',
        'stories_pushed_jira',
        'jira_connected',
        'jira_synced_to_local',
        'github_connected',
        'github_push_analyzed',
        'code_status_updated',
        'sprint_created',
        'sprint_started',
        'sprint_completed',
        'member_invited',
        'member_removed',
        'project_created',
        'project_updated',
        'settings_updated',
      ],
    },
    entity: {
      type: String,
      enum: ['project', 'document', 'epic', 'story', 'sprint', 'user'],
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

AuditLogSchema.index({ project: 1, createdAt: -1 });
AuditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
