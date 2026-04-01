const Sprint = require('../models/Sprint');
const Story = require('../models/Story');
const Project = require('../models/Project');
const SprintService = require('../services/sprintService');
const logger = require('../config/logger');

const getSprints = async (req, res) => {
  try {
    const sprints = await Sprint.find({ project: req.params.projectId }).sort({ order: 1 });
    
    // Enrich with summary info
    const enrichedSprints = await Promise.all(
      sprints.map(async (sprint) => {
        const sprintObj = sprint.toObject();
        const summary = await SprintService.getSprintSummary(sprint._id);
        return { ...sprintObj, summary };
      })
    );
    
    res.status(200).json({ success: true, data: enrichedSprints });
  } catch (error) {
    logger.error(`Get sprints error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error fetching sprints' });
  }
};

const createSprint = async (req, res) => {
  try {
    const count = await Sprint.countDocuments({ project: req.params.projectId });
    const sprint = await Sprint.create({
      ...req.body,
      project: req.params.projectId,
      name: req.body.name || `Sprint ${count + 1}`,
      order: count + 1,
    });
    
    logger.info(`Sprint created: ${sprint._id}`);
    res.status(201).json({ success: true, data: sprint });
  } catch (error) {
    logger.error(`Create sprint error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error creating sprint' });
  }
};

const updateSprint = async (req, res) => {
  try {
    const sprint = await Sprint.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!sprint) {
      return res.status(404).json({ success: false, message: 'Sprint not found' });
    }

    if (req.body.status === 'active') {
      await Sprint.updateMany(
        { project: sprint.project, _id: { $ne: sprint._id }, status: 'active' },
        { status: 'completed', completedAt: new Date() }
      );
      logger.info(`Sprint activated: ${sprint._id}`);
    }

    res.status(200).json({ success: true, data: sprint });
  } catch (error) {
    logger.error(`Update sprint error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error updating sprint' });
  }
};

const deleteSprint = async (req, res) => {
  try {
    const sprint = await Sprint.findById(req.params.id);
    if (!sprint) {
      return res.status(404).json({ success: false, message: 'Sprint not found' });
    }
    
    await sprint.deleteOne();
    logger.info(`Sprint deleted: ${sprint._id}`);
    res.status(200).json({ success: true, message: 'Sprint deleted' });
  } catch (error) {
    logger.error(`Delete sprint error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error deleting sprint' });
  }
};

/**
 * Manually close a sprint
 */
const closeSprint = async (req, res) => {
  try {
    const sprint = await Sprint.findById(req.params.id).populate('project');
    if (!sprint) {
      return res.status(404).json({ success: false, message: 'Sprint not found' });
    }

    if (sprint.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Only active sprints can be closed',
        currentStatus: sprint.status,
      });
    }

    const io = req.app.get('io');
    const result = await SprintService.closeSprint(sprint, 'manual', io);

    res.status(200).json({
      success: true,
      message: 'Sprint closed successfully',
      data: result,
    });
  } catch (error) {
    logger.error(`Close sprint error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error closing sprint' });
  }
};

/**
 * Get sprint summary with statistics
 */
const getSprintSummary = async (req, res) => {
  try {
    const summary = await SprintService.getSprintSummary(req.params.id);
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    logger.error(`Get sprint summary error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error fetching sprint summary' });
  }
};

/**
 * Get upcoming sprint closures (sprints ending within specified hours)
 */
const getUpcomingClosures = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { hoursBeforeAlert = 24 } = req.query;

    const upcoming = await SprintService.getUpcomingClosures(
      projectId,
      parseInt(hoursBeforeAlert, 10)
    );

    res.status(200).json({
      success: true,
      count: upcoming.length,
      data: upcoming,
    });
  } catch (error) {
    logger.error(`Get upcoming closures error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error fetching upcoming closures' });
  }
};

module.exports = {
  getSprints,
  createSprint,
  updateSprint,
  deleteSprint,
  closeSprint,
  getSprintSummary,
  getUpcomingClosures,
};
