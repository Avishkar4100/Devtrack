const Project = require('../models/Project');
const { generateProjectInsights, generateGlobalInsights } = require('../services/insightService');

// @desc    Get AI project insights
// @route   GET /api/insights/:projectId
// @access  Private
const generateInsightsController = async (req, res) => {
  const { projectId } = req.params;

  const project = await Project.findById(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const isMember =
    req.user.role === 'manager' ||
    project.owner.toString() === req.user.id ||
    project.members.some((m) => m.user.toString() === req.user.id);

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
  const filter = req.user.role === 'manager'
    ? {}
    : { $or: [{ owner: req.user.id }, { 'members.user': req.user.id }] };

  const projects = await Project.find(filter).select('_id name status completionPercentage updatedAt');
  const data = await generateGlobalInsights(projects.map((p) => p._id.toString()));

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
