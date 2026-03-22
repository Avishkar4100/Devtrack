const axios = require('axios');
const Project = require('../models/Project');
const Epic = require('../models/Epic');
const Story = require('../models/Story');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');

const normalizeJiraDomain = (domain = '') => {
  const raw = domain.toString().trim().replace(/^"|"$/g, '');
  if (!raw) return '';

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return parsed.hostname;
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/^"|"$/g, '')
      .replace(/\/rest\/api\/\d+.*$/i, '')
      .replace(/\/.*$/, '')
      .replace(/\/+$/g, '');
  }
};

const toAdfText = (text = '') => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: text || '' }] }],
});

const capitalize = (value = '') => value.charAt(0).toUpperCase() + value.slice(1);

const jiraStatusToLocal = (statusName = '') => {
  const name = statusName.toLowerCase();
  if (name.includes('done') || name.includes('closed') || name.includes('resolved')) return 'done';
  if (name.includes('review')) return 'in_review';
  if (name.includes('progress') || name.includes('develop')) return 'in_progress';
  if (name.includes('backlog') || name.includes('open') || name.includes('todo') || name.includes('to do')) return 'to_do';
  return 'approved';
};

const jiraPriorityToLocal = (priorityName = '') => {
  const name = priorityName.toLowerCase();
  if (name.includes('highest')) return 'highest';
  if (name.includes('high')) return 'high';
  if (name.includes('lowest')) return 'lowest';
  if (name.includes('low')) return 'low';
  return 'medium';
};

const localTypeFromJira = (issueType = '') => {
  const t = issueType.toLowerCase();
  if (t === 'task') return 'task';
  if (t === 'bug') return 'bug';
  if (t.includes('sub')) return 'subtask';
  return 'story';
};

const sanitizeJiraPath = (path = '') => {
  if (!path || typeof path !== 'string') return null;
  let cleaned = path.trim();
  cleaned = cleaned.replace(/^\/rest\/api\/\d+/i, '');
  if (!cleaned || cleaned.includes('..') || /^https?:\/\//i.test(cleaned)) return null;
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
};

const jiraRequest = async (client, method, path, options = {}) => {
  const safePath = sanitizeJiraPath(path);
  if (!safePath) {
    const err = new Error('Invalid Jira API path');
    err.statusCode = 400;
    throw err;
  }

  const { params, data } = options;
  try {
    const response = await axios({
      method,
      url: `${client.baseURL}${safePath}`,
      auth: client.auth,
      params,
      data,
    });
    return response.data;
  } catch (error) {
    const status = error.response?.status || 500;
    const remoteMessage =
      error.response?.data?.errorMessages?.[0] ||
      error.response?.data?.message ||
      error.message;
    const err = new Error(`Jira API ${method.toUpperCase()} ${safePath} failed: ${remoteMessage}`);
    err.statusCode = status;
    throw err;
  }
};

const jiraSearch = async ({ client, jql, maxResults = 100, startAt = 0, fields = [] }) => {
  const numericStartAt = Number(startAt) || 0;
  const numericMaxResults = Math.min(Number(maxResults) || 100, 200);

  const payload = {
    jql,
    startAt: numericStartAt,
    maxResults: numericMaxResults,
  };
  if (fields?.length) payload.fields = fields;

  const queryParams = {
    jql,
    startAt: numericStartAt,
    maxResults: numericMaxResults,
  };
  if (fields?.length) queryParams.fields = fields.join(',');

  const isCompatError = (err) => [400, 404, 405, 410].includes(err?.statusCode);
  let lastError = null;

  // Variant 1: GET /search
  try {
    return await jiraRequest(client, 'get', '/search', { params: queryParams });
  } catch (err) {
    lastError = err;
    if (!isCompatError(err)) throw err;
  }

  // Variant 2: POST /search
  try {
    return await jiraRequest(client, 'post', '/search', { data: payload });
  } catch (err) {
    lastError = err;
    if (!isCompatError(err)) throw err;
  }

  // Variant 3: GET /search/jql
  try {
    return await jiraRequest(client, 'get', '/search/jql', { params: queryParams });
  } catch (err) {
    lastError = err;
    if (!isCompatError(err)) throw err;
  }

  // Variant 4: POST /search/jql (minimal payload)
  try {
    return await jiraRequest(client, 'post', '/search/jql', {
      data: {
        jql,
        startAt: numericStartAt,
        maxResults: numericMaxResults,
      },
    });
  } catch (err) {
    lastError = err;
    if (!isCompatError(err)) throw err;
  }

  throw lastError || new Error('No compatible Jira search API variant succeeded');
};

const ensureProjectAccess = async (projectId, user) => {
  const project = await Project.findById(projectId);
  if (!project) {
    const err = new Error('Project not found');
    err.statusCode = 404;
    throw err;
  }

  const isMember =
    user.role === 'manager' ||
    user.role === 'scrum_master' ||
    project.owner.toString() === user.id ||
    project.members.some((m) => m.user.toString() === user.id);

  if (!isMember) {
    const err = new Error('Not authorized to access this project');
    err.statusCode = 403;
    throw err;
  }

  return project;
};

const fetchJiraFields = async (client) => {
  const { data } = await axios.get(`${client.baseURL}/field`, { auth: client.auth });
  return Array.isArray(data) ? data : [];
};

const pickFieldId = (fields, candidates) => {
  const field = fields.find((f) => candidates.includes((f.name || '').toLowerCase()));
  return field?.id;
};

const getJiraClient = async (userId) => {
  const user = await User.findById(userId).select('+jiraApiToken');
  if (!user || !user.jiraApiToken || !user.jiraEmail || !user.jiraDomain) {
    const err = new Error('Jira credentials not configured. Please add your Jira email, domain, and API token in Settings.');
    err.statusCode = 400;
    throw err;
  }

  const jiraDomain = normalizeJiraDomain(user.jiraDomain);
  if (!jiraDomain) {
    const err = new Error('Invalid Jira domain. Example: company.atlassian.net');
    err.statusCode = 400;
    throw err;
  }

  return {
    baseURL: `https://${jiraDomain}/rest/api/3`,
    auth: { username: user.jiraEmail, password: user.jiraApiToken },
    jiraDomain,
  };
};

// @desc    Test Jira connection
// @route   GET /api/jira/test
// @access  Private
const testConnection = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const response = await axios.get(`${client.baseURL}/myself`, { auth: client.auth });
  res.status(200).json({
    success: true,
    data: {
      accountId: response.data.accountId,
      displayName: response.data.displayName,
      emailAddress: response.data.emailAddress,
      jiraDomain: client.jiraDomain,
    },
  });
};

// @desc    Get Jira projects
// @route   GET /api/jira/projects
// @access  Private
const getJiraProjects = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const response = await axios.get(`${client.baseURL}/project/search`, {
    auth: client.auth,
    params: { maxResults: 100 },
  });
  res.status(200).json({ success: true, data: response.data });
};

// @desc    Connect project to Jira
// @route   POST /api/jira/connect/:projectId
// @access  Private
const connectProject = async (req, res) => {
  const { jiraProjectKey } = req.body;
  if (!jiraProjectKey) return res.status(400).json({ success: false, message: 'Jira project key is required' });

  const project = await ensureProjectAccess(req.params.projectId, req.user);
  const client = await getJiraClient(req.user.id);
  const normalizedKey = jiraProjectKey.toString().trim().toUpperCase();

  let jiraProject;
  try {
    const { data } = await axios.get(`${client.baseURL}/project/${normalizedKey}`, { auth: client.auth });
    jiraProject = data;
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.errorMessages?.[0] || err.message;
    logger.warn(`Jira connect validation failed for project ${project._id}: ${msg}`);
    return res.status(status === 404 ? 400 : 500).json({
      success: false,
      message: status === 404 ? `Jira project key ${normalizedKey} not found.` : `Unable to validate Jira project key: ${msg}`,
    });
  }

  project.jiraProjectKey = jiraProject.key;
  project.jiraProjectId = jiraProject.id;
  project.jiraConnected = true;
  await project.save();

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'jira_connected',
    entity: 'project',
    entityId: project._id,
    details: { jiraProjectKey: jiraProject.key, jiraProjectId: jiraProject.id },
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: project, message: `Connected to Jira project ${jiraProject.key}` });
};

// @desc    Push stories to Jira
// @route   POST /api/jira/push/:projectId
// @access  Private
const pushToJira = async (req, res) => {
  const { epicIds, storyIds } = req.body;
  const project = await ensureProjectAccess(req.params.projectId, req.user);

  if (!project.jiraConnected || !project.jiraProjectKey) {
    return res.status(400).json({ success: false, message: 'Project is not connected to Jira' });
  }

  const client = await getJiraClient(req.user.id);
  const jiraFields = await fetchJiraFields(client);
  const storyPointsField = pickFieldId(jiraFields, ['story points', 'story point estimate']);
  const epicLinkField = jiraFields.find((f) => (f.schema?.custom || '').includes('gh-epic-link'))?.id;
  const results = { epics: [], stories: [], errors: [] };

  // Push epics
  for (const epicId of (epicIds || [])) {
    try {
      const epic = await Epic.findById(epicId);
      if (!epic) continue;

      const payload = {
        fields: {
          project: { key: project.jiraProjectKey },
          summary: epic.title,
          description: toAdfText(epic.description || ''),
          issuetype: { name: 'Epic' },
          priority: { name: capitalize(epic.priority || 'medium') },
        },
      };

      if (epic.jiraEpicKey) {
        await axios.put(`${client.baseURL}/issue/${epic.jiraEpicKey}`, { fields: payload.fields }, { auth: client.auth });
        await Epic.findByIdAndUpdate(epicId, {
          pushedToJira: true,
          pushedAt: new Date(),
          status: 'approved',
        });
        results.epics.push({ id: epicId, jiraKey: epic.jiraEpicKey, action: 'updated' });
      } else {
        const response = await axios.post(`${client.baseURL}/issue`, payload, { auth: client.auth });
        await Epic.findByIdAndUpdate(epicId, {
          jiraEpicId: response.data.id,
          jiraEpicKey: response.data.key,
          pushedToJira: true,
          pushedAt: new Date(),
          status: 'approved',
        });
        results.epics.push({ id: epicId, jiraKey: response.data.key, action: 'created' });
      }
    } catch (err) {
      results.errors.push({ id: epicId, type: 'epic', error: err.response?.data?.errorMessages?.[0] || err.message });
    }
  }

  // Push stories
  for (const storyId of (storyIds || [])) {
    try {
      const story = await Story.findById(storyId).populate('epic');
      if (!story) continue;

      const acText = (story.acceptanceCriteria || []).map((a) => `- ${a.criterion}`).join('\n');

      const payload = {
        fields: {
          project: { key: project.jiraProjectKey },
          summary: story.title,
          description: toAdfText(acText ? `${story.description || ''}\n\nAcceptance Criteria:\n${acText}` : story.description || ''),
          issuetype: { name: story.type === 'task' ? 'Task' : 'Story' },
          priority: { name: capitalize(story.priority || 'medium') },
        },
      };

      if (storyPointsField && story.storyPoints) payload.fields[storyPointsField] = story.storyPoints;

      if (story.epic?.jiraEpicKey) {
        if (epicLinkField) payload.fields[epicLinkField] = story.epic.jiraEpicKey;
        payload.fields.parent = { key: story.epic.jiraEpicKey };
      }

      if (story.jiraIssueKey) {
        await axios.put(`${client.baseURL}/issue/${story.jiraIssueKey}`, { fields: payload.fields }, { auth: client.auth });
        await Story.findByIdAndUpdate(storyId, {
          pushedToJira: true,
          pushedAt: new Date(),
        });
        results.stories.push({ id: storyId, jiraKey: story.jiraIssueKey, action: 'updated' });
      } else {
        const response = await axios.post(`${client.baseURL}/issue`, payload, { auth: client.auth });
        await Story.findByIdAndUpdate(storyId, {
          jiraIssueId: response.data.id,
          jiraIssueKey: response.data.key,
          pushedToJira: true,
          pushedAt: new Date(),
          status: 'to_do',
        });
        results.stories.push({ id: storyId, jiraKey: response.data.key, action: 'created' });
      }
    } catch (err) {
      results.errors.push({ id: storyId, type: 'story', error: err.response?.data?.errorMessages?.[0] || err.message });
    }
  }

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'stories_pushed_jira',
    entity: 'project',
    entityId: project._id,
    details: results,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: results });
};

// @desc    Get all Jira projects (server side)
// @route   GET /api/jira/server/projects
// @access  Private
const listServerProjects = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const data = await jiraRequest(client, 'get', '/project/search', {
    params: { maxResults: 100 },
  });
  res.status(200).json({ success: true, data: data.values || [] });
};

// @desc    Create Jira project
// @route   POST /api/jira/server/projects
// @access  Private
const createServerProject = async (req, res) => {
  const { key, name, projectTypeKey, projectTemplateKey, leadAccountId, description } = req.body;
  if (!key || !name) {
    return res.status(400).json({ success: false, message: 'Project key and name are required' });
  }

  const client = await getJiraClient(req.user.id);
  const payload = {
    key: key.toUpperCase(),
    name,
    projectTypeKey: projectTypeKey || 'software',
    projectTemplateKey: projectTemplateKey || 'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic',
  };
  if (leadAccountId) payload.leadAccountId = leadAccountId;
  if (description) payload.description = description;

  const data = await jiraRequest(client, 'post', '/project', { data: payload });
  res.status(201).json({ success: true, data });
};

// @desc    Update Jira project
// @route   PUT /api/jira/server/projects/:projectIdOrKey
// @access  Private
const updateServerProject = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const data = await jiraRequest(client, 'put', `/project/${req.params.projectIdOrKey}`, { data: req.body });
  res.status(200).json({ success: true, data: data || { updated: true } });
};

// @desc    Delete Jira project
// @route   DELETE /api/jira/server/projects/:projectIdOrKey
// @access  Private
const deleteServerProject = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  await jiraRequest(client, 'delete', `/project/${req.params.projectIdOrKey}`);
  res.status(200).json({ success: true, message: 'Jira project deleted' });
};

// @desc    List Jira issues by project/JQL
// @route   GET /api/jira/server/issues
// @access  Private
const listServerIssues = async (req, res) => {
  const { projectKey, jql, maxResults = 100, startAt = 0 } = req.query;
  const client = await getJiraClient(req.user.id);
  const resolvedJql = jql || (projectKey ? `project=${projectKey} ORDER BY updated DESC` : 'ORDER BY updated DESC');

  const data = await jiraSearch({
    client,
    jql: resolvedJql,
    startAt,
    maxResults,
    fields: ['summary', 'description', 'priority', 'status', 'issuetype', 'parent', 'project', 'assignee', 'updated'],
  });

  res.status(200).json({ success: true, data });
};

// @desc    Get Jira issue detail
// @route   GET /api/jira/server/issues/:issueKey
// @access  Private
const getServerIssue = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const data = await jiraRequest(client, 'get', `/issue/${req.params.issueKey}`);
  res.status(200).json({ success: true, data });
};

// @desc    Create Jira issue
// @route   POST /api/jira/server/issues
// @access  Private
const createServerIssue = async (req, res) => {
  const { projectKey, summary, description, issueType = 'Story', priority } = req.body;
  if (!projectKey || !summary) {
    return res.status(400).json({ success: false, message: 'projectKey and summary are required' });
  }

  const client = await getJiraClient(req.user.id);
  const payload = {
    fields: {
      project: { key: projectKey },
      summary,
      description: toAdfText(description || ''),
      issuetype: { name: issueType },
    },
  };
  if (priority) payload.fields.priority = { name: priority };

  const data = await jiraRequest(client, 'post', '/issue', { data: payload });
  res.status(201).json({ success: true, data });
};

// @desc    Update Jira issue
// @route   PUT /api/jira/server/issues/:issueKey
// @access  Private
const updateServerIssue = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const { summary, description, priority, issueType } = req.body;
  const fields = {};
  if (summary !== undefined) fields.summary = summary;
  if (description !== undefined) fields.description = toAdfText(description || '');
  if (priority !== undefined) fields.priority = { name: priority };
  if (issueType !== undefined) fields.issuetype = { name: issueType };

  await jiraRequest(client, 'put', `/issue/${req.params.issueKey}`, { data: { fields } });
  res.status(200).json({ success: true, message: 'Jira issue updated' });
};

// @desc    Delete Jira issue
// @route   DELETE /api/jira/server/issues/:issueKey
// @access  Private
const deleteServerIssue = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  await jiraRequest(client, 'delete', `/issue/${req.params.issueKey}`);
  res.status(200).json({ success: true, message: 'Jira issue deleted' });
};

// @desc    AI summary for Jira project
// @route   GET /api/jira/server/issues/summary/:projectKey
// @access  Private
const getJiraAISummary = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const projectKey = req.params.projectKey;
  const search = await jiraSearch({
    client,
    jql: `project=${projectKey} ORDER BY updated DESC`,
    maxResults: 100,
    fields: ['summary', 'status', 'priority', 'issuetype'],
  });

  const issues = (search.issues || []).map((issue) => ({
    key: issue.key,
    summary: issue.fields?.summary || '',
    status: issue.fields?.status?.name || '',
    priority: issue.fields?.priority?.name || '',
    type: issue.fields?.issuetype?.name || '',
  }));

  const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
  try {
    const { data } = await axios.post(
      `${aiUrl}/jira/summarize`,
      {
        project_key: projectKey,
        issues,
      },
      { timeout: 20000 }
    );

    return res.status(200).json({ success: true, data: data.data || data });
  } catch (error) {
    logger.warn(`Jira AI summary fallback for ${projectKey}: ${error.message}`);
    return res.status(200).json({
      success: true,
      data: {
        summary: `Project ${projectKey} has ${issues.length} tracked Jira issues. AI summary unavailable at the moment.`,
        topRisks: ['AI summary provider timeout or unavailable'],
        nextActions: ['Retry summary later', 'Verify AI service is running', 'Check provider/API connectivity'],
      },
    });
  }
};

// @desc    Transition Jira issue
// @route   POST /api/jira/server/issues/:issueKey/transitions
// @access  Private
const transitionServerIssue = async (req, res) => {
  const { transitionId } = req.body;
  if (!transitionId) return res.status(400).json({ success: false, message: 'transitionId is required' });
  const client = await getJiraClient(req.user.id);
  await jiraRequest(client, 'post', `/issue/${req.params.issueKey}/transitions`, {
    data: { transition: { id: transitionId } },
  });
  res.status(200).json({ success: true, message: 'Issue transitioned' });
};

// @desc    Jira REST API proxy (full control)
// @route   POST /api/jira/server/proxy
// @access  Private
const jiraProxy = async (req, res) => {
  const { method = 'get', path, params, data } = req.body;
  const client = await getJiraClient(req.user.id);
  const payload = await jiraRequest(client, method.toLowerCase(), path, { params, data });
  res.status(200).json({ success: true, data: payload });
};

// @desc    Pull Jira issues into local epics/stories
// @route   POST /api/jira/sync/:projectId
// @access  Private
const syncFromJira = async (req, res) => {
  const project = await ensureProjectAccess(req.params.projectId, req.user);

  if (!project.jiraConnected || !project.jiraProjectKey) {
    return res.status(400).json({ success: false, message: 'Project is not connected to Jira' });
  }

  const client = await getJiraClient(req.user.id);
  const search = await jiraSearch({
    client,
    jql: `project=${project.jiraProjectKey} ORDER BY updated DESC`,
    maxResults: 200,
    fields: ['summary', 'description', 'priority', 'status', 'issuetype', 'parent'],
  });

  const issues = search.issues || [];
  const epicByJiraKey = new Map();
  let syncedEpics = 0;
  let syncedStories = 0;

  for (const issue of issues) {
    const issueType = issue.fields?.issuetype?.name || 'Story';
    if (issueType.toLowerCase() !== 'epic') continue;

    const epic = await Epic.findOneAndUpdate(
      { project: project._id, jiraEpicId: issue.id },
      {
        project: project._id,
        title: issue.fields?.summary || issue.key,
        description: issue.fields?.description?.content?.[0]?.content?.[0]?.text || '',
        jiraEpicId: issue.id,
        jiraEpicKey: issue.key,
        status: jiraStatusToLocal(issue.fields?.status?.name),
        priority: jiraPriorityToLocal(issue.fields?.priority?.name),
        pushedToJira: true,
      },
      { new: true, upsert: true }
    );

    epicByJiraKey.set(issue.key, epic._id.toString());
    syncedEpics += 1;
  }

  for (const issue of issues) {
    const issueType = issue.fields?.issuetype?.name || 'Story';
    if (issueType.toLowerCase() === 'epic') continue;

    const parentKey = issue.fields?.parent?.key;
    const epicId = parentKey ? epicByJiraKey.get(parentKey) : null;
    await Story.findOneAndUpdate(
      { project: project._id, jiraIssueId: issue.id },
      {
        project: project._id,
        epic: epicId || undefined,
        title: issue.fields?.summary || issue.key,
        description: issue.fields?.description?.content?.[0]?.content?.[0]?.text || '',
        type: localTypeFromJira(issueType),
        jiraIssueId: issue.id,
        jiraIssueKey: issue.key,
        status: jiraStatusToLocal(issue.fields?.status?.name),
        priority: jiraPriorityToLocal(issue.fields?.priority?.name),
        pushedToJira: true,
      },
      { new: true, upsert: true }
    );
    syncedStories += 1;
  }

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'jira_synced_to_local',
    entity: 'project',
    entityId: project._id,
    details: { syncedEpics, syncedStories },
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: { syncedEpics, syncedStories, totalIssues: issues.length } });
};

module.exports = {
  testConnection,
  getJiraProjects,
  connectProject,
  pushToJira,
  listServerProjects,
  createServerProject,
  updateServerProject,
  deleteServerProject,
  listServerIssues,
  getServerIssue,
  createServerIssue,
  updateServerIssue,
  deleteServerIssue,
  transitionServerIssue,
  jiraProxy,
  syncFromJira,
  getJiraAISummary,
};
