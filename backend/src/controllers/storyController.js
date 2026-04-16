const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Epic = require('../models/Epic');
const Story = require('../models/Story');
const Project = require('../models/Project');
const Document = require('../models/Document');
const Requirement = require('../models/Requirement');
const Sprint = require('../models/Sprint');
const Commit = require('../models/Commit');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const aiService = require('../services/aiService');
const DocumentService = require('../services/documentService');
const { buildProjectStateSnapshot } = require('../services/projectStateManager');
const SocketService = require('../services/socketService');
const { sendEmail, storyCreatedEmail, storyAssignedEmail } = require('../services/email');
const logger = require('../config/logger');
const { getClientErrorMessage } = require('../utils/errorUtils');

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

// @desc    Get epics and stories for a project
// @route   GET /api/stories/project/:projectId
// @access  Private
const getStoriesByProject = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.projectId || ''))) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

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

// @desc    Get precise project state snapshot for discovery/suggestion flow
// @route   GET /api/stories/project-state/:projectId
// @access  Private (Manager/Scrum Master)
const getProjectState = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.projectId || ''))) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

  const project = await Project.findById(req.params.projectId).lean();
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const state = await buildProjectStateSnapshot(project._id.toString());
  res.status(200).json({ success: true, data: state });
};

// @desc    Get epics for a project
// @route   GET /api/stories/epics/:projectId
// @access  Private
const getEpics = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.projectId || ''))) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

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

  const aiHealth = await aiService.checkHealth();
  const activeAiConfig = await aiService.getActiveAIConfigPayload();
  if (!aiHealth.online) {
    return res.status(503).json({
      success: false,
      message: 'ai-service is offline. Start ai-service and retry Suggest.',
      data: {
        provider: activeAiConfig?.provider || null,
        model: activeAiConfig?.openrouterModel || activeAiConfig?.deepseekModel || null,
      },
    });
  }

  const processedDoc = await Document.findOne({ project: project._id, status: 'processed', isActive: true })
    .sort({ updatedAt: -1 })
    .lean();

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

  const users = await User.find({
    _id: {
      $in: [project.owner, ...(project.members || []).map((m) => m.user).filter(Boolean)],
    },
  }).select('name').lean();
  const userNameMap = new Map(users.map((u) => [String(u._id), u.name || 'Unknown']));
  const teamMembers = [
    {
      id: String(project.owner),
      name: userNameMap.get(String(project.owner)) || 'Project Owner',
      role: 'Owner',
    },
    ...(project.members || []).map((m) => ({
      id: String(m.user),
      name: userNameMap.get(String(m.user)) || 'Team Member',
      role: m.role || 'manager',
    })),
  ];

  const planningWarnings = [];
  let contextQuality = 'high';
  if (!processedDoc) {
    contextQuality = 'low';
    planningWarnings.push('No processed SRS found. Generated backlog is using project graph fallback context.');
  }

  const enhancedContext = [additionalContext, projectStateContext, graphContext].filter(Boolean).join('\n\n');

  const result = await aiService.generateStories({
    projectId: project._id.toString(),
    projectName: project.name,
    moduleName,
    documentId,
    additionalContext: enhancedContext,
    budget: project.budget,
    deadline: project.deadline,
    teamMembers,
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

  res.status(200).json({
    success: true,
    data: {
      ...result,
      planningMeta: {
        contextQuality,
        usedProcessedSrs: Boolean(processedDoc),
        processedDocumentId: processedDoc?._id || null,
        warnings: planningWarnings,
      },
    },
  });
};

// @desc    Suggest next planning prompts using vectorless context graph
// @route   POST /api/stories/suggest/:projectId
// @access  Private (Manager/Scrum Master)
const suggestStories = async (req, res) => {
  const { moduleName, userInput, projectState: providedProjectState } = req.body;
  if (!moduleName) {
    return res.status(400).json({ success: false, message: 'Module name is required' });
  }

  const project = await Project.findById(req.params.projectId);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const [requirements, stories, commits] = await Promise.all([
    Requirement.findOne({ project: project._id }).lean(),
    Story.find({ project: project._id }).sort({ updatedAt: -1 }).limit(120).lean(),
    Commit.find({ projectId: project._id }).sort({ date: -1 }).limit(40).lean(),
  ]);

  const latestProcessedDoc = await Document.findOne({
    project: project._id,
    status: 'processed',
    isActive: true,
  }).sort({ updatedAt: -1 }).lean();

  const doneStories = stories.filter((s) => s.status === 'done').length;
  let phase = 'start';
  if (stories.length > 10) phase = 'mid';
  if (doneStories > 20) phase = 'late';

  const existingStories = stories.slice(0, 10).map((s) => ({
    title: s.title,
    type: s.type,
    status: s.status,
    sprint: s.sprint,
    priority: s.priority,
  }));

  const structuredContext = {
    modules: Array.isArray(requirements?.modules) ? requirements.modules : [],
    functional: Array.isArray(requirements?.functional) ? requirements.functional : [],
    nonFunctional: Array.isArray(requirements?.nonFunctional) ? requirements.nonFunctional : [],
    actors: Array.isArray(requirements?.actors) ? requirements.actors : [],
    phase,
    existingStories,
    recentCommits: commits.slice(0, 8).map((c) => c.message || c.sha).filter(Boolean),
  };

  logger.info(`Suggest request project=${project._id} module=${moduleName} phase=${phase} modules=${structuredContext.modules.length} fr=${structuredContext.functional.length} nfr=${structuredContext.nonFunctional.length} actors=${structuredContext.actors.length} userInputChars=${(userInput || '').length}`);

  let requirementMap = latestProcessedDoc?.requirementMap || null;
  if (!requirementMap || !Array.isArray(requirementMap.items) || !requirementMap.items.length) {
    const generatedMap = await DocumentService.generateRequirementMap(project._id.toString(), { source: 'auto_on_suggest' });
    requirementMap = generatedMap.requirementMap;
  }

  const projectState = providedProjectState && typeof providedProjectState === 'object' && !Array.isArray(providedProjectState)
    ? providedProjectState
    : await buildProjectStateSnapshot(project._id);
  const completedJiraIds = Array.isArray(projectState.completedJiraIds) ? projectState.completedJiraIds : [];

  let discoveredRequirementIds = [];
  try {
    const discovery = await aiService.discoverGaps({
      projectId: project._id.toString(),
      moduleName,
      userInput: userInput || '',
      requirementMap: requirementMap || { items: [] },
      projectState,
      completedJiraIds,
    });
    discoveredRequirementIds = Array.isArray(discovery?.requirement_ids) ? discovery.requirement_ids : [];
  } catch (err) {
    logger.warn(`Suggest discovery failed project=${project._id}: ${err.message}`);
  }

  if (!discoveredRequirementIds.length && Array.isArray(requirementMap?.items)) {
    discoveredRequirementIds = requirementMap.items.slice(0, 8).map((x) => x.id).filter(Boolean);
  }

  let fetchedChunks = [];
  if (discoveredRequirementIds.length) {
    try {
      const fetchResult = await aiService.getChunksByIds({
        projectId: project._id.toString(),
        requirementIds: discoveredRequirementIds,
        topKPerId: 2,
      });
      fetchedChunks = Array.isArray(fetchResult?.chunks) ? fetchResult.chunks : [];
    } catch (err) {
      logger.warn(`Suggest targeted fetch failed project=${project._id}: ${err.message}`);
    }
  }

  let result;
  try {
    result = await aiService.suggestStories({
      projectId: project._id.toString(),
      projectName: project.name,
      moduleName,
      userInput: userInput || '',
      contextGraph: {
        ...structuredContext,
        fetchedChunks,
        projectState,
      },
    });
  } catch (error) {
    if (error.code === 'AI_SERVICE_UNAVAILABLE') {
      logger.warn(`Suggest failed project=${project._id} reason=ai_service_unavailable`);
      return res.status(503).json({
        success: false,
        message: 'AI suggestion service is unavailable. Start ai-service and verify model credentials, then try again.',
        data: {
          provider: activeAiConfig?.provider || null,
          model: activeAiConfig?.openrouterModel || activeAiConfig?.deepseekModel || null,
        },
      });
    }

    logger.warn(`Suggest failed project=${project._id} reason=ai_suggest_failed detail=${error.message}`);
    return res.status(502).json({
      success: false,
      message: `AI suggestion request failed for provider ${activeAiConfig?.provider || 'unknown'}: ${error.message}`,
      data: {
        provider: activeAiConfig?.provider || null,
        model: activeAiConfig?.openrouterModel || activeAiConfig?.deepseekModel || null,
        contextSummary: {
          source: 'requirements_structured',
          phase,
          moduleCount: structuredContext.modules.length,
          functionalCount: structuredContext.functional.length,
          nonFunctionalCount: structuredContext.nonFunctional.length,
          actorCount: structuredContext.actors.length,
        },
      },
    });
  }

  const structuredSuggestions = { epics: [], stories: [], tasks: [] };
  const rawActions = Array.isArray(result?.suggestions) ? result.suggestions : [];
  const normalizedActions = rawActions.slice(0, 7).map((action, idx) => ({
    id: String(action?.id || `sug-${idx + 1}`),
    title: String(action?.title || '').trim(),
    description: String(action?.description || '').trim(),
    impact: String(action?.impact || 'medium').trim(),
    estimated_effort: String(action?.estimated_effort || 'medium').trim(),
    module: String(action?.module || moduleName).trim(),
    type: String(action?.type || 'story').trim(),
  })).filter((action) => Boolean(action.title));

  normalizedActions.forEach((action) => {
    const line = `${action.title}${action.reason ? ` - ${action.reason}` : ''}`;
    if (action.type === 'integration' || action.type === 'epic') structuredSuggestions.epics.push(line);
    else if (action.type === 'improvement' || action.type === 'task') structuredSuggestions.tasks.push(line);
    else structuredSuggestions.stories.push(line);
  });

  if (!normalizedActions.length) {
    return res.status(502).json({
      success: false,
      message: 'AI returned no actionable suggestions for the current discovery request. Please retry with a narrower prompt.',
    });
  }

  logger.info(`Suggest AI response project=${project._id} actions=${normalizedActions.length} epics=${structuredSuggestions.epics.length} stories=${structuredSuggestions.stories.length} tasks=${structuredSuggestions.tasks.length}`);

  const flatSuggestions = [
    ...structuredSuggestions.epics.map((s) => `EPIC: ${s}`),
    ...structuredSuggestions.stories.map((s) => `STORY: ${s}`),
    ...structuredSuggestions.tasks.map((s) => `TASK: ${s}`),
  ];

  res.status(200).json({
    success: true,
    data: {
      suggestions: flatSuggestions,
      structuredSuggestions,
      planningMeta: {
        contextQuality: latestProcessedDoc ? 'high' : 'low',
        usedProcessedSrs: Boolean(latestProcessedDoc),
        processedDocumentId: latestProcessedDoc?._id || null,
        requirementMapItems: Array.isArray(requirementMap?.items) ? requirementMap.items.length : 0,
        discoveredRequirementIds,
        fetchedChunks: fetchedChunks.length,
        warnings: latestProcessedDoc
          ? []
          : ['No processed SRS found. Suggestions are generated from project graph fallback context.'],
      },
      contextSummary: {
        source: 'requirements_structured',
        phase,
        moduleCount: structuredContext.modules.length,
        functionalCount: structuredContext.functional.length,
        nonFunctionalCount: structuredContext.nonFunctional.length,
        actorCount: structuredContext.actors.length,
      },
    },
  });
};

const normalizeGeneratedPayload = (body = {}) => ({
  epics: Array.isArray(body.epics) ? body.epics : [],
  stories: Array.isArray(body.stories) ? body.stories : [],
  tasks: Array.isArray(body.tasks) ? body.tasks : [],
  subtasks: Array.isArray(body.subtasks) ? body.subtasks : [],
});

const hasTitle = (row) => Boolean(String(row?.title || '').trim());

const validateGeneratedPayload = ({ epics, stories, tasks, subtasks }) => {
  const errors = [];

  epics.forEach((row, idx) => {
    if (!hasTitle(row)) errors.push(`epics[${idx}] title is required`);
  });
  stories.forEach((row, idx) => {
    if (!hasTitle(row)) errors.push(`stories[${idx}] title is required`);
  });
  tasks.forEach((row, idx) => {
    if (!hasTitle(row)) errors.push(`tasks[${idx}] title is required`);
  });
  subtasks.forEach((row, idx) => {
    if (!hasTitle(row)) errors.push(`subtasks[${idx}] title is required`);
  });

  const epicIds = new Set(epics.map((e, idx) => e.tempId || e.title || `epic-${idx}`));
  const storyIds = new Set(stories.map((s, idx) => s.tempId || s.title || `story-${idx}`));
  const taskIds = new Set(tasks.map((t, idx) => t.tempId || t.title || `task-${idx}`));

  stories.forEach((row, idx) => {
    if (row.epicTempId && !epicIds.has(row.epicTempId)) {
      errors.push(`stories[${idx}] references missing epicTempId '${row.epicTempId}'`);
    }
  });

  tasks.forEach((row, idx) => {
    if (row.epicTempId && !epicIds.has(row.epicTempId)) {
      errors.push(`tasks[${idx}] references missing epicTempId '${row.epicTempId}'`);
    }
    if (row.parentTempId && !storyIds.has(row.parentTempId)) {
      errors.push(`tasks[${idx}] references missing parentTempId '${row.parentTempId}'`);
    }
  });

  subtasks.forEach((row, idx) => {
    if (row.epicTempId && !epicIds.has(row.epicTempId)) {
      errors.push(`subtasks[${idx}] references missing epicTempId '${row.epicTempId}'`);
    }
    if (row.parentTempId && !taskIds.has(row.parentTempId)) {
      errors.push(`subtasks[${idx}] references missing parentTempId '${row.parentTempId}'`);
    }
  });

  return errors;
};

// @desc    Save/approve generated stories
// @route   POST /api/stories/save/:projectId
// @access  Private (Scrum Master)
const saveGeneratedStories = async (req, res) => {
  const { epics, stories, tasks, subtasks } = normalizeGeneratedPayload(req.body);

  if (!epics.length && !stories.length && !tasks.length && !subtasks.length) {
    return res.status(400).json({
      success: false,
      message: 'No backlog items provided. Add at least one epic/story/task/subtask before save.',
    });
  }

  const validationErrors = validateGeneratedPayload({ epics, stories, tasks, subtasks });
  if (validationErrors.length) {
    return res.status(400).json({
      success: false,
      message: 'Generated backlog payload is invalid',
      errors: validationErrors,
    });
  }

  const today = new Date();
  const defaultDue = new Date(today);
  defaultDue.setDate(defaultDue.getDate() + 5);

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
    const parentTempId = storyData.parentTempId || storyData.parentId;
    const parentRef = parentTempId ? storyTempMap[parentTempId] : undefined;

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
      status: 'to_do',
      assignee: normalizeAssignee(storyData.assignee),
      parentStory: parentRef,
      startDate: normalizeDate(storyData.startDate) || today,
      dueDate: normalizeDate(storyData.dueDate) || defaultDue,
      reporter: req.user.id,
    });
    savedStories.push(story);
    if (storyData.tempId) storyTempMap[storyData.tempId] = story._id;
  }

  // Save subtasks linked to parent stories
  for (const sub of (subtasks || [])) {
    const subParentTempId = sub.parentTempId || sub.parentId;
    const parentId = subParentTempId ? storyTempMap[subParentTempId] : savedStories[0]?._id;
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
      status: 'to_do',
      assignee: normalizeAssignee(sub.assignee),
      startDate: normalizeDate(sub.startDate) || today,
      dueDate: normalizeDate(sub.dueDate) || defaultDue,
      reporter: req.user.id,
    });
  }

  // Update project counts
  await updateProjectCounts(project._id);

  // Emit WebSocket event for bulk save
  const io = req.app.get('io');
  if (io) {
    SocketService.storiesSaved(io, project._id.toString(), {
      epicCount: savedEpics.length,
      storyCount: savedStories.filter((s) => !s.type || s.type === 'story').length,
      taskCount: savedStories.filter((s) => s.type === 'task').length,
      subtaskCount: (subtasks || []).length,
    });
  }

  res.status(201).json({
    success: true,
    data: { epics: savedEpics, stories: savedStories },
  });
};

// @desc    Create story manually
// @route   POST /api/stories
// @access  Private
const createStory = async (req, res) => {
  try {
    const story = await Story.create({ ...req.body, reporter: req.user.id });
    await updateProjectCounts(story.project);

    // Populate for email
    const populatedStory = await story.populate([
      { path: 'reporter', select: 'name email' },
      { path: 'epic', select: 'title' },
      { path: 'project', select: 'name' },
    ]);

    // Send creation email to team members
    try {
      const project = await Project.findById(story.project).populate('members.user', 'email name');
      if (project && project.members && project.members.length > 0) {
        const teamEmails = project.members
          .map((m) => m.user?.email)
          .filter((email) => email && email !== req.user.email);

        if (teamEmails.length > 0) {
          const htmlContent = storyCreatedEmail(
            story.title,
            story.description,
            populatedStory.epic?.title || 'Unassigned',
            project.name,
            req.user.name || 'Team'
          );

          await Promise.all(
            teamEmails.map((email) =>
              sendEmail({
                to: email,
                subject: `📋 New Story: ${story.title}`,
                html: htmlContent,
              }).catch((err) => logger.error('Failed to send story creation email:', err.message))
            )
          );
        }
      }
    } catch (emailErr) {
      logger.error('Email notification error (non-blocking):', emailErr.message);
    }

    // Emit WebSocket event
    const io = req.app.get('io');
    const projectId = story.project?.toString?.() || '';
    if (io && projectId) {
      SocketService.storyCreated(io, projectId, story);
    }

    res.status(201).json({ success: true, data: story });
  } catch (err) {
    logger.error('Story creation error:', err);
    const inferredStatus = (err.name === 'ValidationError' || err.name === 'CastError') ? 400 : 500;
    const statusCode = Number(err.statusCode || inferredStatus);
    res.status(statusCode).json({
      success: false,
      message: getClientErrorMessage(err, 'Failed to create story'),
    });
  }
};

// @desc    Update story
// @route   PUT /api/stories/:id
// @access  Private
const updateStory = async (req, res) => {
  try {
    const previousStory = await Story.findById(req.params.id).select('assignee');
    const wasAssigneeChanged = previousStory && req.body.assignee && previousStory.assignee?.toString() !== req.body.assignee;

    const story = await Story.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate('assignee', 'name email avatar').populate('epic', 'title').populate('parentStory', 'title storyKey').populate('project', 'name');

    if (!story) return res.status(404).json({ success: false, message: 'Story not found' });

    const projectId = story.project?._id?.toString?.() || '';
    if (!projectId) {
      logger.warn(`Story ${story._id} has an invalid or missing project reference during update`);
      return res.status(409).json({
        success: false,
        message: 'Story is linked to an invalid project. Please refresh project data and try again.',
      });
    }

    const projectName = story.project?.name || 'Project';

    await updateProjectCounts(projectId);

    // Send assignment notification email
    if (wasAssigneeChanged && story.assignee?.email) {
      try {
        const reporter = await User.findById(req.user.id).select('name');
        const htmlContent = storyAssignedEmail(
          story.title,
          story.assignee.name,
          projectName,
          reporter?.name || 'Team',
          {
            epicTitle: story.epic?.title,
            priority: story.priority,
            dueDate: story.dueDate,
            storyPoints: story.storyPoints,
          }
        );

        await sendEmail({
          to: story.assignee.email,
          subject: `📋 Assigned to You: ${story.title}`,
          html: htmlContent,
        }).catch((err) => logger.error('Failed to send assignment email:', err.message));
      } catch (emailErr) {
        logger.error('Assignment email error (non-blocking):', emailErr.message);
      }
    }

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      SocketService.storyUpdated(io, projectId, story);
      if (wasAssigneeChanged) {
        SocketService.storyAssigned(io, projectId, story);
      }
    }

    await AuditLog.create({
      project: projectId,
      user: req.user.id,
      action: 'story_edited',
      entity: 'story',
      entityId: story._id,
      details: { changes: Object.keys(req.body) },
      ipAddress: req.ip,
    });

    res.status(200).json({ success: true, data: story });
  } catch (err) {
    logger.error('Story update error:', err);
    const inferredStatus = (err.name === 'ValidationError' || err.name === 'CastError') ? 400 : 500;
    const statusCode = Number(err.statusCode || inferredStatus);
    res.status(statusCode).json({
      success: false,
      message: getClientErrorMessage(err, 'Failed to update story'),
    });
  }
};

// @desc    Delete story
// @route   DELETE /api/stories/:id
// @access  Private
const deleteStory = async (req, res) => {
  const story = await Story.findById(req.params.id);
  if (!story) return res.status(404).json({ success: false, message: 'Story not found' });

  const projectId = story.project;
  await story.deleteOne();
  await updateProjectCounts(projectId);

  // Emit WebSocket event
  const io = req.app.get('io');
  if (io) {
    SocketService.storyDeleted(io, projectId.toString(), story._id.toString());
  }

  await AuditLog.create({
    project: projectId,
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

// @desc    Bulk assign stories to user
// @route   POST /api/stories/bulk-assign
// @access  Private (Manager/Scrum Master)
const bulkAssignStories = async (req, res) => {
  try {
    const { storyIds = [], assigneeId, projectId } = req.body;

    if (!storyIds.length || !assigneeId) {
      return res.status(400).json({
        success: false,
        message: 'Story IDs and assignee ID are required',
      });
    }

    // Fetch assignee
    const assignee = await User.findById(assigneeId).select('name email');
    if (!assignee) {
      return res.status(404).json({ success: false, message: 'Assignee not found' });
    }

    // Update all stories
    const result = await Story.updateMany(
      { _id: { $in: storyIds }, project: projectId },
      { assignee: assigneeId },
      { runValidators: true }
    );

    // Fetch updated stories for email
    const updatedStories = await Story.find({ _id: { $in: storyIds } }).select('title storyPoints priority epic');
    const project = await Project.findById(projectId).select('name');
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    const reporter = await User.findById(req.user.id).select('name');

    // Send bulk assignment email
    if (assignee.email) {
      try {
        const { bulkAssignmentEmail } = require('../services/email');
        const htmlContent = bulkAssignmentEmail(
          assignee.name,
          project.name,
          updatedStories,
          reporter?.name || 'Team'
        );

        await sendEmail({
          to: assignee.email,
          subject: `📚 ${storyIds.length} Stories Assigned to You in ${project.name}`,
          html: htmlContent,
        }).catch((err) => logger.error('Failed to send bulk assignment email:', err.message));
      } catch (emailErr) {
        logger.error('Bulk assignment email error (non-blocking):', emailErr.message);
      }
    }

    // Emit WebSocket event for each story
    const io = req.app.get('io');
    if (io) {
      updatedStories.forEach((story) => {
        SocketService.storyAssigned(io, projectId.toString(), story);
      });
      SocketService.notify(io, projectId.toString(), `${storyIds.length} stories assigned to ${assignee.name}`, 'success');
    }

    await updateProjectCounts(projectId);

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} stories assigned to ${assignee.name}`,
      data: { modifiedCount: result.modifiedCount, assignee },
    });
  } catch (err) {
    logger.error('Bulk assignment error:', err);
    const inferredStatus = (err.name === 'ValidationError' || err.name === 'CastError') ? 400 : 500;
    const statusCode = Number(err.statusCode || inferredStatus);
    res.status(statusCode).json({
      success: false,
      message: getClientErrorMessage(err, 'Failed to bulk assign stories'),
    });
  }
};

module.exports = {
  getStoriesByProject,
  getEpics,
  getProjectState,
  generateStories,
  suggestStories,
  saveGeneratedStories,
  createStory,
  updateStory,
  deleteStory,
  bulkAssignStories,
};
