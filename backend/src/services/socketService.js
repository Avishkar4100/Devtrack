/**
 * Socket.IO Event Service
 * Centralized WebSocket event emissions for real-time updates
 */

const logger = require('../config/logger');

class SocketService {
  static emitToProject(io, projectId, event, data) {
    if (!io || !projectId) {
      logger.warn('SocketService: Missing io or projectId');
      return;
    }
    try {
      io.to(`project:${projectId}`).emit(event, {
        type: event,
        timestamp: new Date().toISOString(),
        data,
      });
    } catch (err) {
      logger.error(`SocketService error emitting ${event}:`, err);
    }
  }

  // Story events
  static storyCreated(io, projectId, story) {
    this.emitToProject(io, projectId, 'story:created', {
      id: story._id,
      title: story.title,
      type: story.type || 'story',
      epic: story.epic,
      assignee: story.assignee,
      status: story.status,
      priority: story.priority,
      storyPoints: story.storyPoints,
    });
  }

  static storyUpdated(io, projectId, story) {
    this.emitToProject(io, projectId, 'story:updated', {
      id: story._id,
      title: story.title,
      type: story.type || 'story',
      epic: story.epic,
      assignee: story.assignee,
      status: story.status,
      priority: story.priority,
      storyPoints: story.storyPoints,
      updatedAt: story.updatedAt,
    });
  }

  static storyDeleted(io, projectId, storyId) {
    this.emitToProject(io, projectId, 'story:deleted', {
      id: storyId,
    });
  }

  // Bulk events
  static storiesSaved(io, projectId, payload) {
    const { epicCount, storyCount, taskCount, subtaskCount } = payload;
    this.emitToProject(io, projectId, 'stories:saved', {
      epicCount,
      storyCount,
      taskCount,
      subtaskCount,
      totalCount: epicCount + storyCount + taskCount + subtaskCount,
    });
  }

  // Sprint events
  static sprintUpdated(io, projectId, sprint) {
    this.emitToProject(io, projectId, 'sprint:updated', {
      id: sprint._id,
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.startDate,
      dueDate: sprint.dueDate,
      completionPercentage: sprint.completionPercentage,
    });
  }

  // Assignment events
  static storyAssigned(io, projectId, story) {
    this.emitToProject(io, projectId, 'story:assigned', {
      id: story._id,
      title: story.title,
      assignee: story.assignee,
      assignedAt: new Date().toISOString(),
    });
  }

  // Notification events
  static notify(io, projectId, message, type = 'info') {
    this.emitToProject(io, projectId, 'notification', {
      message,
      type, // 'success', 'error', 'warning', 'info'
      timestamp: new Date().toISOString(),
    });
  }

  // Project sync events
  static projectSynced(io, projectId, syncType, stats) {
    this.emitToProject(io, projectId, 'project:synced', {
      syncType, // 'jira', 'github', 'full'
      stats,
      syncedAt: new Date().toISOString(),
    });
  }
}

module.exports = SocketService;
