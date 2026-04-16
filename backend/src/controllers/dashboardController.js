const Project = require('../models/Project');
const Epic = require('../models/Epic');
const Story = require('../models/Story');
const Sprint = require('../models/Sprint');
const AuditLog = require('../models/AuditLog');
const Commit = require('../models/Commit');
const Document = require('../models/Document');
const { generateGlobalInsights } = require('../services/insightService');
const mongoose = require('mongoose');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const percent = (num, den) => {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
};

const getHealthState = (score) => {
  if (score >= 85) return 'healthy';
  if (score >= 60) return 'watch';
  return 'risk';
};

const weekKey = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
};

// @desc    Get project dashboard data
// @route   GET /api/dashboard/:projectId
// @access  Private
const getDashboard = async (req, res) => {
  if (!isValidObjectId(req.params.projectId)) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

  const project = await Project.findById(req.params.projectId)
    .populate('owner', 'name email avatar')
    .populate('members.user', 'name email avatar');

  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const [epics, stories, sprints, recentActivity] = await Promise.all([
    Epic.find({ project: project._id }).sort({ order: 1 }),
    Story.find({ project: project._id })
      .populate('assignee', 'name email avatar')
      .sort('-updatedAt'),
    Sprint.find({ project: project._id }).sort({ order: 1 }),
    AuditLog.find({ project: project._id })
      .populate('user', 'name email avatar')
      .sort('-createdAt')
      .limit(15),
  ]);

  // Stats
  const totalStories = stories.length;
  const doneStories = stories.filter((s) => s.status === 'done').length;
  const inProgressStories = stories.filter((s) => s.status === 'in_progress').length;
  const toDoStories = stories.filter((s) => s.status === 'to_do').length;
  const notStarted = stories.filter((s) => s.codeStatus === 'not_started').length;
  const codeDone = stories.filter((s) => s.codeStatus === 'done').length;
  const codePartial = stories.filter((s) => s.codeStatus === 'partial').length;

  // Risk alerts
  const risks = [];
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  stories.forEach((s) => {
    if (s.status === 'in_progress' && (!s.updatedAt || s.updatedAt < threeDaysAgo)) {
      risks.push({ type: 'stale_story', message: `Story "${s.title}" has had no updates for 3+ days`, storyId: s._id });
    }
    if (s.dueDate && new Date(s.dueDate) < new Date() && s.status !== 'done') {
      risks.push({ type: 'overdue', message: `Story "${s.title}" is overdue`, storyId: s._id });
    }
  });

  if (project.deadline && new Date(project.deadline) < new Date() && project.completionPercentage < 100) {
    risks.push({ type: 'project_overdue', message: 'Project deadline has passed with incomplete stories' });
  }

  // Module heatmap: by epic
  const heatmap = epics.map((epic) => {
    const epicStories = stories.filter(
      (s) => s.epic && s.epic.toString() === epic._id.toString()
    );
    const done = epicStories.filter((s) => s.status === 'done').length;
    const total = epicStories.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      epicId: epic._id,
      title: epic.title,
      total,
      done,
      completionPercentage: pct,
      status: pct === 100 ? 'green' : pct > 0 ? 'yellow' : 'red',
    };
  });

  // Sprint velocity data
  const activeSprint = sprints.find((s) => s.status === 'active');
  const burndownData = activeSprint?.burndownData || [];

  res.status(200).json({
    success: true,
    data: {
      project,
      stats: {
        total: totalStories,
        done: doneStories,
        inProgress: inProgressStories,
        toDo: toDoStories,
        completionPercentage: project.completionPercentage,
        codeStatus: { done: codeDone, partial: codePartial, notStarted },
      },
      epics,
      heatmap,
      risks,
      recentActivity,
      activeSprint,
      burndownData,
      sprints,
    },
  });
};

// @desc    Get project-level overview (admin multi-project)
// @route   GET /api/dashboard/overview
// @access  Private
const getOverview = async (req, res) => {
  const projects = await Project.find({
    $or: [{ owner: req.user.id }, { 'members.user': req.user.id }],
  }).sort('-updatedAt');

  const summaries = projects.map((p) => ({
    id: p._id,
    name: p.name,
    key: p.key,
    status: p.status,
    completionPercentage: p.completionPercentage,
    totalStories: p.totalStories,
    completedStories: p.completedStories,
    deadline: p.deadline,
    color: p.color,
  }));

  res.status(200).json({ success: true, data: summaries });
};

// @desc    Get consolidated overview summary for dashboard + context sync
// @route   GET /api/dashboard/overview-summary
// @access  Private
const getOverviewSummary = async (req, res) => {
  const projectFilter = req.user.role === 'admin'
    ? {}
    : { $or: [{ owner: req.user.id }, { 'members.user': req.user.id }] };

  const projects = await Project.find(projectFilter)
    .select('_id name key status completionPercentage updatedAt color jiraProjectKey owner members')
    .sort('-updatedAt')
    .lean();

  const insights = await generateGlobalInsights(projects.map((p) => p._id.toString()));
  const insightByProjectId = new Map(
    (insights.projects || []).map((row) => [row.projectId.toString(), row])
  );

  const enrichedProjects = projects.map((project) => {
    const insight = insightByProjectId.get(project._id.toString()) || {};
    return {
      _id: project._id.toString(),
      name: project.name,
      key: project.key,
      status: project.status,
      completionPercentage: project.completionPercentage || 0,
      updatedAt: project.updatedAt,
      color: project.color,
      jiraProjectKey: project.jiraProjectKey || null,
      risk: insight.risk || 'low',
      summary: insight.summary || '',
      activeDevelopers: insight.activeDevelopers || [],
      totalStories: insight.totalStories || 0,
      completedStories: insight.completedStories || 0,
    };
  });

  const totalProjects = enrichedProjects.length;
  const activeProjects = enrichedProjects.filter((p) => p.status === 'active').length;
  const avgProgress = totalProjects
    ? Math.round(enrichedProjects.reduce((sum, p) => sum + (p.completionPercentage || 0), 0) / totalProjects)
    : 0;
  const highRiskProjects = enrichedProjects.filter((p) => p.risk === 'high').length;

  const defaultProject = enrichedProjects.find((p) => p.status === 'active') || enrichedProjects[0] || null;

  res.status(200).json({
    success: true,
    data: {
      metrics: {
        totalProjects,
        activeProjects,
        avgProgress,
        highRiskProjects,
      },
      summary: insights.summary,
      projects: enrichedProjects,
      selectedProjectId: defaultProject?._id?.toString?.() || defaultProject?._id || null,
      selectedJiraProjectKey: defaultProject?.jiraProjectKey || null,
      selectedProjectSummary: defaultProject?.summary || '',
      generatedAt: new Date().toISOString(),
    },
  });
};

// @desc    Get workspace control tower metrics
// @route   GET /api/dashboard/:projectId/control-tower
// @access  Private
const getControlTower = async (req, res) => {
  if (!isValidObjectId(req.params.projectId)) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

  const project = await Project.findById(req.params.projectId).lean();
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const isAllowed =
    req.user.role === 'admin' ||
    String(project.owner) === req.user.id ||
    (project.members || []).some((m) => String(m.user) === req.user.id);

  if (!isAllowed) {
    return res.status(403).json({ success: false, message: 'Not authorized to view this project workspace data' });
  }

  const [stories, commits, docs] = await Promise.all([
    Story.find({ project: project._id }).lean(),
    Commit.find({ projectId: project._id }).sort({ date: -1 }).limit(200).lean(),
    Document.find({ project: project._id, isActive: true }).sort({ updatedAt: -1 }).limit(20).lean(),
  ]);

  const workItems = stories.filter((s) => ['story', 'task', 'subtask', 'bug'].includes(s.type));
  const aiGeneratedCount = workItems.filter((s) => s.aiGenerated).length;
  const completedCount = workItems.filter((s) => s.status === 'done').length;
  const approvedCount = workItems.filter((s) => ['approved', 'in_progress', 'in_review', 'done'].includes(s.status)).length;
  const reviewedCount = workItems.filter((s) => ['in_review', 'done'].includes(s.status)).length;
  const mergedCount = workItems.filter((s) => ['partial', 'done'].includes(s.codeStatus)).length;
  const jiraEligible = workItems.filter((s) => s.type !== 'subtask').length;
  const jiraPushed = workItems.filter((s) => s.type !== 'subtask' && s.pushedToJira).length;
  const codeMapped = workItems.filter((s) => Array.isArray(s.codeEvidence) && s.codeEvidence.length > 0).length;

  const commitMappedPct = percent(codeMapped, Math.max(workItems.length, 1));
  const jiraSyncSuccessPct = percent(jiraPushed, Math.max(jiraEligible, 1));
  const standupTimeSavedHours = Math.round(((commitMappedPct + jiraSyncSuccessPct) / 200) * 30) / 10;

  const lastSixWeeks = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    lastSixWeeks.push(weekKey(d));
  }

  const createdByWeek = new Map(lastSixWeeks.map((k) => [k, 0]));
  const doneByWeek = new Map(lastSixWeeks.map((k) => [k, 0]));
  workItems.forEach((item) => {
    const created = weekKey(item.createdAt || item.updatedAt || now);
    if (createdByWeek.has(created)) createdByWeek.set(created, createdByWeek.get(created) + 1);

    if (item.status === 'done') {
      const finished = weekKey(item.updatedAt || item.createdAt || now);
      if (doneByWeek.has(finished)) doneByWeek.set(finished, doneByWeek.get(finished) + 1);
    }
  });

  const throughput = {
    labels: lastSixWeeks,
    created: lastSixWeeks.map((k) => createdByWeek.get(k) || 0),
    completed: lastSixWeeks.map((k) => doneByWeek.get(k) || 0),
  };

  const validationTrend = lastSixWeeks.map((_, idx) => {
    const ratio = (idx + 1) / lastSixWeeks.length;
    const base = Math.max(45, Math.min(98, commitMappedPct));
    return Math.round(base * (0.75 + ratio * 0.25));
  });

  const latestDoc = docs[0] || null;
  const latestDocProcessed = latestDoc?.status === 'processed';
  const jiraHealthScore = project.jiraConnected ? jiraSyncSuccessPct : 45;
  const commitHealthScore = commits.length >= 3 ? commitMappedPct : Math.max(40, commitMappedPct - 20);
  const ingestHealthScore = latestDoc
    ? (latestDocProcessed ? 95 : latestDoc.status === 'processing' ? 68 : 50)
    : 55;

  const toolHealth = [
    {
      name: 'Jira Sync Worker',
      status: getHealthState(jiraHealthScore),
      detail: project.jiraConnected
        ? `${jiraSyncSuccessPct}% issues pushed successfully`
        : 'Jira not connected for this project',
    },
    {
      name: 'GitHub Commit Validator',
      status: getHealthState(commitHealthScore),
      detail: `${commitMappedPct}% backlog items linked to code evidence`,
    },
    {
      name: 'Document Ingestion',
      status: getHealthState(ingestHealthScore),
      detail: latestDoc
        ? `${latestDoc.name} is ${latestDoc.status}`
        : 'No SRS uploaded yet',
    },
  ];

  const funnel = [
    { stage: 'Generated', value: aiGeneratedCount },
    { stage: 'Reviewed', value: reviewedCount },
    { stage: 'Approved', value: approvedCount },
    { stage: 'Merged', value: mergedCount },
    { stage: 'Released', value: completedCount },
  ];

  const topSignals = [
    `${commits.length} recent commits captured`,
    `${completedCount}/${workItems.length || 0} backlog items completed`,
    latestDocProcessed ? 'Latest SRS is processed and usable for planning' : 'Planning is currently using fallback context',
  ];

  res.status(200).json({
    success: true,
    data: {
      projectId: project._id,
      kpis: {
        aiIssuesCreated: aiGeneratedCount,
        commitMappedPct,
        jiraSyncSuccessPct,
        standupTimeSavedHours,
      },
      validationTrend,
      throughput,
      funnel,
      toolHealth,
      engineeringSignals: topSignals,
      contextQuality: latestDocProcessed ? 'high' : 'low',
      generatedAt: new Date().toISOString(),
    },
  });
};

module.exports = { getDashboard, getOverview, getOverviewSummary, getControlTower };
