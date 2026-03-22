const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Epic = require('../models/Epic');
const Story = require('../models/Story');
const Project = require('../models/Project');
const Document = require('../models/Document');
const Sprint = require('../models/Sprint');
const Commit = require('../models/Commit');
const AuditLog = require('../models/AuditLog');
const aiService = require('../services/aiService');

const readSnippetFromDocument = (filePath, maxChars = 4000) => {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return '';
    const text = fs.readFileSync(resolved, 'utf-8');
    return (text || '').slice(0, maxChars).trim();
  } catch (_) {
    return '';
  }
};

const buildVectorlessContextGraph = async (projectId) => {
  const [project, docs, epics, stories, sprints, commits] = await Promise.all([
    Project.findById(projectId).lean(),
    Document.find({ project: projectId, isActive: true }).sort({ createdAt: -1 }).limit(3).lean(),
    Epic.find({ project: projectId }).sort({ createdAt: -1 }).limit(20).lean(),
    Story.find({ project: projectId }).sort({ updatedAt: -1 }).limit(200).lean(),
    Sprint.find({ project: projectId }).sort({ createdAt: -1 }).limit(20).lean(),
    Commit.find({ projectId }).sort({ date: -1 }).limit(40).lean(),
  ]);

  const docNodes = docs.map((doc) => ({
    id: doc._id.toString(),
    type: 'document',
    title: doc.name,
    status: doc.status,
    snippet: readSnippetFromDocument(doc.filePath),
  }));

  const epicNodes = epics.map((epic) => ({
    id: epic._id.toString(),
    type: 'epic',
    title: epic.title,
    status: epic.status,
    sprint: epic.sprint,
    priority: epic.priority,
  }));

  const storyNodes = stories.map((story) => ({
    id: story._id.toString(),
    type: story.type || 'story',
    title: story.title,
    status: story.status,
    sprint: story.sprint,
    priority: story.priority,
    codeStatus: story.codeStatus,
    epicId: story.epic ? story.epic.toString() : null,
    parentStoryId: story.parentStory ? story.parentStory.toString() : null,
  }));

  const sprintNodes = sprints.map((sprint) => ({
    id: sprint._id.toString(),
    type: 'sprint',
    name: sprint.name,
    status: sprint.status,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    goal: sprint.goal,
  }));

  const commitNodes = commits.map((commit) => ({
    id: commit._id.toString(),
    type: 'commit',
    sha: commit.sha,
    message: commit.message,
    author: commit.author,
    date: commit.date,
    filesChanged: commit.filesChanged,
  }));

  const edges = [];
  storyNodes.forEach((story) => {
    if (story.epicId) edges.push({ from: story.epicId, to: story.id, relation: 'contains' });
    if (story.parentStoryId) edges.push({ from: story.parentStoryId, to: story.id, relation: 'parent_of' });
  });

  const stats = {
    totalStories: storyNodes.length,
    doneStories: storyNodes.filter((s) => s.status === 'done').length,
    inProgressStories: storyNodes.filter((s) => s.status === 'in_progress').length,
    backlogStories: storyNodes.filter((s) => s.sprint === 'backlog').length,
    activeSprints: sprintNodes.filter((s) => s.status === 'active').length,
    recentCommits: commitNodes.length,
  };

  return {
    project: {
      id: project?._id?.toString(),
      name: project?.name,
      key: project?.key,
      status: project?.status,
      completionPercentage: project?.completionPercentage || 0,
    },
    nodes: {
      documents: docNodes,
      epics: epicNodes,
      stories: storyNodes,
      sprints: sprintNodes,
      commits: commitNodes,
    },
    edges,
    stats,
  };
};

const buildSrsOnlyContext = async (projectId) => {
  const docs = await Document.find({ project: projectId, isActive: true, status: 'processed' })
    .sort({ createdAt: -1 })
    .limit(2)
    .lean();

  const docContexts = docs.map((doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    fileType: doc.fileType,
    snippet: readSnippetFromDocument(doc.filePath, 12000),
  }));

  return {
    source: 'srs_only',
    documents: docContexts,
  };
};

// @desc    Get epics and stories for a project
// @route   GET /api/stories/project/:projectId
// @access  Private
const getStoriesByProject = async (req, res) => {
  const { epicId, status, type } = req.query;
  const filter = { project: req.params.projectId };
  if (epicId) filter.epic = epicId;
  if (status) filter.status = status;
  if (type) filter.type = type;

  const stories = await Story.find(filter)
    .populate('epic', 'title epicKey color')
    .populate('assignee', 'name email avatar')
    .populate('parentStory', 'title storyKey')
    .populate('reporter', 'name email avatar')
    .sort({ order: 1, createdAt: -1 });

  res.status(200).json({ success: true, count: stories.length, data: stories });
};

// @desc    Get epics for a project
// @route   GET /api/stories/epics/:projectId
// @access  Private
const getEpics = async (req, res) => {
  const epics = await Epic.find({ project: req.params.projectId }).sort({ order: 1 });
  res.status(200).json({ success: true, count: epics.length, data: epics });
};

// @desc    Generate stories using AI
// @route   POST /api/stories/generate/:projectId
// @access  Private (Scrum Master)
const generateStories = async (req, res) => {
  const { moduleName, documentId, additionalContext } = req.body;

  if (!moduleName) {
    return res.status(400).json({ success: false, message: 'Module name is required' });
  }

  const project = await Project.findById(req.params.projectId);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  // Block generation if no processed SRS document exists for this project
  const processedDoc = await Document.findOne({ project: project._id, status: 'processed', isActive: true });
  if (!processedDoc) {
    return res.status(400).json({
      success: false,
      message: 'No processed SRS document found. Please upload and process an SRS/MD document first before generating stories.',
    });
  }

  const [totalStories, completedStories, activeSprint] = await Promise.all([
    Story.countDocuments({ project: project._id, type: { $in: ['story', 'task'] } }),
    Story.countDocuments({ project: project._id, type: { $in: ['story', 'task'] }, status: 'done' }),
    Sprint.findOne({ project: project._id, status: 'active' }).sort({ updatedAt: -1 }),
  ]);
  const pendingStories = Math.max(totalStories - completedStories, 0);

  const projectStateContext = [
    'Current project state:',
    `- Completed tasks: ${completedStories}`,
    `- Pending: ${pendingStories}`,
    `- Current sprint: ${activeSprint?.name || 'No active sprint'}`,
  ].join('\n');

  const contextGraph = await buildVectorlessContextGraph(project._id);
  const graphContext = `\n\nVectorless project graph context:\n${JSON.stringify(contextGraph)}`;

  const enhancedContext = [additionalContext, projectStateContext, graphContext].filter(Boolean).join('\n\n');

  const result = await aiService.generateStories({
    projectId: project._id.toString(),
    projectName: project.name,
    moduleName,
    documentId,
    additionalContext: enhancedContext,
    budget: project.budget,
    deadline: project.deadline,
  });

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'stories_generated',
    entity: 'project',
    entityId: project._id,
    details: { moduleName, generatedCount: result.stories?.length || 0 },
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: result });
};

// @desc    Suggest next planning prompts using vectorless context graph
// @route   POST /api/stories/suggest/:projectId
// @access  Private (Manager/Scrum Master)
const suggestStories = async (req, res) => {
  const { moduleName, userInput } = req.body;
  if (!moduleName) {
    return res.status(400).json({ success: false, message: 'Module name is required' });
  }

  const project = await Project.findById(req.params.projectId);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const contextGraph = await buildSrsOnlyContext(project._id);

  if (!contextGraph.documents.length) {
    return res.status(400).json({
      success: false,
      message: 'No processed SRS found. Upload and process SRS before requesting suggestions.',
    });
  }

  const result = await aiService.suggestStories({
    projectId: project._id.toString(),
    projectName: project.name,
    moduleName,
    userInput: userInput || '',
    contextGraph,
  });

  res.status(200).json({
    success: true,
    data: {
      suggestions: result.suggestions || [],
      contextSummary: {
        source: contextGraph.source,
        documentCount: contextGraph.documents.length,
      },
    },
  });
};

// @desc    Save/approve generated stories
// @route   POST /api/stories/save/:projectId
// @access  Private (Scrum Master)
const saveGeneratedStories = async (req, res) => {
  const { epics, stories, tasks, subtasks } = req.body;

  const normalizeAssignee = (value) => (
    value && mongoose.Types.ObjectId.isValid(value) ? value : undefined
  );

  const normalizeDate = (value) => {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  const project = await Project.findById(req.params.projectId);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const savedEpics = [];
  const epicMap = {};

  // Save epics
  let epicIdx = 0;
  for (const epicData of (epics || [])) {
    const epic = await Epic.create({
      project: project._id,
      title: epicData.title,
      description: epicData.description,
      sprint: epicData.sprint || 'backlog',
      priority: epicData.priority || 'medium',
      epicKey: `${project.key}-EPIC-${Date.now()}-${epicIdx++}`,
      aiGenerated: true,
      status: 'approved',
    });
    savedEpics.push(epic);
    epicMap[epicData.tempId || epicData.title] = epic._id;
  }

  // Save stories and tasks
  const savedStories = [];
  const storyTempMap = {}; // map tempId -> saved _id for subtask linking
  let storyIdx = 0;
  for (const storyData of [...(stories || []), ...(tasks || [])]) {
    const epicRef = storyData.epicTempId
      ? epicMap[storyData.epicTempId]
      : savedEpics[0]?._id;
    const parentRef = storyData.parentTempId ? storyTempMap[storyData.parentTempId] : undefined;

    // Sanitize sprint/priority to valid enum values
    const validSprints = ['S1', 'S2', 'S3', 'S4', 'backlog'];
    const validPriorities = ['highest', 'high', 'medium', 'low', 'lowest'];
    const sprint = validSprints.includes(storyData.sprint) ? storyData.sprint : 'backlog';
    const priority = validPriorities.includes(storyData.priority) ? storyData.priority : 'medium';

    const story = await Story.create({
      project: project._id,
      epic: epicRef,
      type: storyData.type || 'story',
      title: storyData.title,
      description: storyData.description,
      acceptanceCriteria: (storyData.acceptanceCriteria || []).map((c) => ({
        criterion: typeof c === 'string' ? c : c.criterion,
        met: false,
      })),
      sprint,
      priority,
      storyPoints: storyData.storyPoints || 0,
      storyKey: `${project.key}-${Date.now()}-${storyIdx++}`,
      aiGenerated: true,
      status: 'approved',
      assignee: normalizeAssignee(storyData.assignee),
      parentStory: parentRef,
      startDate: normalizeDate(storyData.startDate),
      dueDate: normalizeDate(storyData.dueDate),
      reporter: req.user.id,
    });
    savedStories.push(story);
    if (storyData.tempId) storyTempMap[storyData.tempId] = story._id;
  }

  // Save subtasks linked to parent stories
  for (const sub of (subtasks || [])) {
    const parentId = sub.parentTempId ? storyTempMap[sub.parentTempId] : savedStories[0]?._id;
    const epicRef = sub.epicTempId ? epicMap[sub.epicTempId] : savedEpics[0]?._id;
    const validSprints = ['S1', 'S2', 'S3', 'S4', 'backlog'];
    const validPriorities = ['highest', 'high', 'medium', 'low', 'lowest'];
    const sprint = validSprints.includes(sub.sprint) ? sub.sprint : 'backlog';
    const priority = validPriorities.includes(sub.priority) ? sub.priority : 'medium';
    await Story.create({
      project: project._id,
      epic: epicRef,
      parentStory: parentId,
      type: 'subtask',
      title: sub.title,
      description: sub.description || '',
      acceptanceCriteria: (sub.acceptanceCriteria || []).map((c) => ({
        criterion: typeof c === 'string' ? c : c.criterion,
        met: false,
      })),
      sprint,
      priority,
      storyPoints: sub.storyPoints || 1,
      storyKey: `${project.key}-SUB-${Date.now()}-${storyIdx++}`,
      aiGenerated: true,
      status: 'approved',
      assignee: normalizeAssignee(sub.assignee),
      startDate: normalizeDate(sub.startDate),
      dueDate: normalizeDate(sub.dueDate),
      reporter: req.user.id,
    });
  }

  // Update project counts
  await updateProjectCounts(project._id);

  res.status(201).json({
    success: true,
    data: { epics: savedEpics, stories: savedStories },
  });
};

// @desc    Create story manually
// @route   POST /api/stories
// @access  Private
const createStory = async (req, res) => {
  const story = await Story.create({ ...req.body, reporter: req.user.id });
  await updateProjectCounts(story.project);
  res.status(201).json({ success: true, data: story });
};

// @desc    Update story
// @route   PUT /api/stories/:id
// @access  Private
const updateStory = async (req, res) => {
  const story = await Story.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('assignee', 'name email avatar').populate('epic', 'title').populate('parentStory', 'title storyKey');

  if (!story) return res.status(404).json({ success: false, message: 'Story not found' });

  await updateProjectCounts(story.project);

  // Emit socket event
  const io = req.app.get('io');
  if (io) {
    io.to(`project:${story.project}`).emit('story:updated', story);
  }

  await AuditLog.create({
    project: story.project,
    user: req.user.id,
    action: 'story_edited',
    entity: 'story',
    entityId: story._id,
    details: { changes: Object.keys(req.body) },
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: story });
};

// @desc    Delete story
// @route   DELETE /api/stories/:id
// @access  Private
const deleteStory = async (req, res) => {
  const story = await Story.findById(req.params.id);
  if (!story) return res.status(404).json({ success: false, message: 'Story not found' });

  await story.deleteOne();
  await updateProjectCounts(story.project);

  await AuditLog.create({
    project: story.project,
    user: req.user.id,
    action: 'story_deleted',
    entity: 'story',
    entityId: story._id,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, message: 'Story deleted' });
};

// Helper: update project story counts
const updateProjectCounts = async (projectId) => {
  const total = await Story.countDocuments({ project: projectId, type: { $in: ['story', 'task'] } });
  const completed = await Story.countDocuments({ project: projectId, status: 'done' });
  const inProgress = await Story.countDocuments({ project: projectId, status: 'in_progress' });
  const completionPercentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  await Project.findByIdAndUpdate(projectId, {
    totalStories: total,
    completedStories: completed,
    inProgressStories: inProgress,
    completionPercentage,
  });

  // Update epics
  const epics = await Epic.find({ project: projectId });
  for (const epic of epics) {
    const epicTotal = await Story.countDocuments({ epic: epic._id });
    const epicDone = await Story.countDocuments({ epic: epic._id, status: 'done' });
    await Epic.findByIdAndUpdate(epic._id, {
      totalStories: epicTotal,
      completedStories: epicDone,
      completionPercentage: epicTotal > 0 ? Math.round((epicDone / epicTotal) * 100) : 0,
    });
  }
};

module.exports = {
  getStoriesByProject,
  getEpics,
  generateStories,
  suggestStories,
  saveGeneratedStories,
  createStory,
  updateStory,
  deleteStory,
};
