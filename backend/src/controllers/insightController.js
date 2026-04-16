const Project = require('../models/Project');
const { generateProjectInsights, generateGlobalInsights } = require('../services/insightService');
const mongoose = require('mongoose');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const toIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') {
      return value.toHexString();
    }
    if (value._id && value._id !== value) {
      return toIdString(value._id);
    }
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const text = value.toString();
      return text === '[object Object]' ? '' : text;
    }
  }
  return '';
};

// @desc    Get AI project insights
// @route   GET /api/insights/:projectId
// @access  Private
const generateInsightsController = async (req, res) => {
  const { projectId } = req.params;

  if (!isValidObjectId(projectId)) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

  const project = await Project.findById(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const ownerId = toIdString(project.owner);
  const memberIds = Array.isArray(project.members)
    ? project.members.map((m) => toIdString(m?.user)).filter(Boolean)
    : [];

  if (!ownerId) {
    return res.status(409).json({
      success: false,
      message: 'Project has an invalid owner reference. Reassign project ownership and retry.',
    });
  }

  const isMember =
    req.user.role === 'admin' ||
    ownerId === req.user.id ||
    memberIds.includes(req.user.id);

  if (!isMember) {
    return res.status(403).json({ success: false, message: 'Not authorized to view this project insights' });
  }

  const data = await generateProjectInsights(projectId);
  return res.status(200).json({ success: true, data });
};

// @desc    Get global insights across visible projects
// @route   GET /api/insights/global
// @access  Private
const generateGlobalInsightsController = async (req, res) => {
  const filter = req.user.role === 'admin'
    ? {}
    : { $or: [{ owner: req.user.id }, { 'members.user': req.user.id }] };

  const projects = await Project.find(filter).select('_id name status completionPercentage updatedAt');
  const projectIds = projects.map((p) => toIdString(p?._id)).filter(Boolean);
  const data = await generateGlobalInsights(projectIds);

  const byProjectId = new Map(data.projects.map((p) => [p.projectId.toString(), p]));
  const mappedProjects = projects.map((project) => {
    const insight = byProjectId.get(project._id.toString()) || {};
    return {
      _id: project._id,
      name: project.name,
      status: project.status,
      completionPercentage: project.completionPercentage,
      updatedAt: project.updatedAt,
      risk: insight.risk || 'low',
      activeDevelopers: insight.activeDevelopers || [],
    };
  });

  return res.status(200).json({
    success: true,
    data: {
      summary: data.summary,
      highRiskProjects: data.highRiskProjects,
      avgProgress: data.avgProgress,
      projects: mappedProjects,
    },
  });
};

module.exports = { generateInsightsController, generateGlobalInsightsController };
