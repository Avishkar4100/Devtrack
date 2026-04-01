/**
 * Sprint Management Service
 * Handles sprint lifecycle including auto-closure logic
 */

const Sprint = require('../models/Sprint');
const Story = require('../models/Story');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');

class SprintService {
  /**
   * Auto-close sprints that have passed their end date
   * Called by scheduled job (cron)
   */
  static async autoCloseSprints(io = null) {
    try {
      const now = new Date();
      
      // Find active sprints that have passed their end date
      const expiredSprints = await Sprint.find({
        status: 'active',
        endDate: { $lt: now },
      }).populate('project');

      if (expiredSprints.length === 0) {
        logger.debug('No expired sprints to auto-close');
        return { processed: 0, closed: 0, errors: 0 };
      }

      logger.info(`Found ${expiredSprints.length} expired sprints for auto-closure`);

      let closedCount = 0;
      let errorCount = 0;

      for (const sprint of expiredSprints) {
        try {
          await this.closeSprint(sprint, 'auto_expired', io);
          closedCount++;
        } catch (error) {
          logger.error(`Failed to auto-close sprint ${sprint._id}: ${error.message}`);
          errorCount++;
        }
      }

      logger.info(
        `Auto-closure complete: ${closedCount} closed, ${errorCount} errors`
      );

      return {
        processed: expiredSprints.length,
        closed: closedCount,
        errors: errorCount,
      };
    } catch (error) {
      logger.error(`Auto-closure job failed: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Manually close a sprint with story handling
   */
  static async closeSprint(sprint, reason = 'manual', io = null) {
    try {
      const startTime = Date.now();

      // Find all non-done stories in this sprint
      const incompleteStories = await Story.find({
        sprint: sprint._id,
        status: { $nin: ['done', 'cancelled'] },
      });

      logger.info(
        `Closing sprint ${sprint._id}: ${incompleteStories.length} incomplete stories to handle`
      );

      let movedCount = 0;
      let closedCount = 0;

      // Handle incomplete stories
      for (const story of incompleteStories) {
        // Move to backlog if it was in progress or waiting
        if (['to_do', 'in_progress', 'in_review'].includes(story.status)) {
          story.sprint = 'backlog';
          await story.save();
          movedCount++;
        }
      }

      // Calculate sprint statistics
      const closedStories = await Story.countDocuments({
        sprint: sprint._id,
        status: 'done',
      });

      // Update sprint with closure info
      const updateData = {
        status: 'completed',
        completedAt: new Date(),
        wasAutoClosed: reason !== 'manual',
        closureReason: reason,
        autoClosedAt: reason !== 'manual' ? new Date() : undefined,
        storiesClosed: closedStories,
        storiesIncomplete: incompleteStories.length - movedCount,
        storiesMoved: movedCount,
      };

      // Remove undefined values
      Object.keys(updateData).forEach(
        key => updateData[key] === undefined && delete updateData[key]
      );

      const updatedSprint = await Sprint.findByIdAndUpdate(sprint._id, updateData, {
        new: true,
      }).populate('project');

      // Emit WebSocket event
      if (io && updatedSprint.project) {
        io.to(`project:${updatedSprint.project._id}`).emit('sprint:closed', {
          sprintId: updatedSprint._id,
          status: 'completed',
          closureReason: reason,
          wasAutoClosed: reason !== 'manual',
          storiesClosed: closedStories,
          storiesMoved: movedCount,
        });
      }

      // Create audit log
      await AuditLog.create({
        project: sprint.project,
        action: 'sprint_closed',
        entity: 'sprint',
        entityId: sprint._id,
        details: {
          reason,
          wasAutoClosed: reason !== 'manual',
          storiesClosed: closedStories,
          storiesMoved: movedCount,
          processingTime: Date.now() - startTime,
        },
      });

      logger.info(
        `Sprint ${sprint._id} closed (${reason}): ` +
        `${closedStories} done, ${movedCount} moved to backlog, ` +
        `${incompleteStories.length - movedCount} remaining`
      );

      return {
        sprintId: updatedSprint._id,
        storiesClosed: closedStories,
        storiesMoved: movedCount,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      logger.error(`Error closing sprint ${sprint._id}: ${error.message}`, {
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get sprint summary with closure stats
   */
  static async getSprintSummary(sprintId) {
    try {
      const sprint = await Sprint.findById(sprintId).populate('project');
      if (!sprint) {
        throw new Error('Sprint not found');
      }

      const total = await Story.countDocuments({ sprint: sprintId });
      const done = await Story.countDocuments({
        sprint: sprintId,
        status: 'done',
      });
      const inProgress = await Story.countDocuments({
        sprint: sprintId,
        status: 'in_progress',
      });
      const inReview = await Story.countDocuments({
        sprint: sprintId,
        status: 'in_review',
      });
      const todo = await Story.countDocuments({
        sprint: sprintId,
        status: 'to_do',
      });

      const completionPercentage = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        sprintId: sprint._id,
        name: sprint.name,
        status: sprint.status,
        endDate: sprint.endDate,
        completionPercentage,
        stories: {
          total,
          done,
          inProgress,
          inReview,
          todo,
          remaining: total - done,
        },
        closure: {
          completedAt: sprint.completedAt,
          wasAutoClosed: sprint.wasAutoClosed,
          closureReason: sprint.closureReason,
          autoClosedAt: sprint.autoClosedAt,
          storiesClosed: sprint.storiesClosed,
          storiesIncomplete: sprint.storiesIncomplete,
          storiesMoved: sprint.storiesMoved,
        },
        isOverdue: sprint.status === 'active' && sprint.endDate < new Date(),
      };
    } catch (error) {
      logger.error(`Error getting sprint summary: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get upcoming sprints needing attention
   */
  static async getUpcomingClosures(projectId, hoursBeforeAlert = 24) {
    try {
      const now = new Date();
      const alertThreshold = new Date(now.getTime() + hoursBeforeAlert * 60 * 60 * 1000);

      const sprints = await Sprint.find({
        project: projectId,
        status: 'active',
        endDate: { $gte: now, $lte: alertThreshold },
      });

      const summaries = await Promise.all(
        sprints.map(sprint => this.getSprintSummary(sprint._id))
      );

      return summaries.filter(s => s.stories.remaining > 0);
    } catch (error) {
      logger.error(`Error getting upcoming closures: ${error.message}`);
      throw error;
    }
  }
}

module.exports = SprintService;
