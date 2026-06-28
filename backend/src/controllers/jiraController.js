const axios = require('axios');
const Project = require('../models/Project');
const Epic = require('../models/Epic');
const Story = require('../models/Story');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');
const { getActiveAIConfigPayload } = require('../services/aiConfigService');
const { resolveAiServiceBaseUrl } = require('../utils/aiServiceUrl');

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

const parseJiraPathFromUrl = (value = '') => {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search || ''}`;
  } catch {
    return value;
  }
};

const isUserRoleActor = (actor) => actor?.type === 'atlassian-user-role-actor';

const buildMemberFromUser = (user = {}, roleName = '') => ({
  accountId: user?.accountId || null,
  name: user?.displayName || user?.name || user?.publicName || user?.emailAddress || 'Unknown',
  email: user?.emailAddress || 'N/A',
  avatar: user?.avatarUrls?.['48x48'] || null,
  type: 'atlassian-user-role-actor',
  accountType: user?.accountType || null,
  roles: roleName ? [roleName] : [],
});

const jiraAgileRequest = async (client, method, path, options = {}) => {
  const safePath = sanitizeJiraPath(path);
  if (!safePath) {
    const err = new Error('Invalid Jira Agile API path');
    err.statusCode = 400;
    throw err;
  }

  const { params, data } = options;
  const agileBaseURL = `https://${client.jiraDomain}/rest/agile/1.0`;

  try {
    const response = await axios({
      method,
      url: `${agileBaseURL}${safePath}`,
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
    const err = new Error(`Jira Agile API ${method.toUpperCase()} ${safePath} failed: ${remoteMessage}`);
    err.statusCode = status;
    throw err;
  }
};

const fetchGroupMembers = async (client, actorGroup = {}) => {
  const members = [];
  const groupId = actorGroup?.groupId;
  const groupName = actorGroup?.name;
  if (!groupId && !groupName) return members;

  let startAt = 0;
  let hasMore = true;
  while (hasMore) {
    const params = { startAt, maxResults: 50 };
    if (groupId) params.groupId = groupId;
    else params.groupname = groupName;

    let data;
    try {
      data = await jiraRequest(client, 'get', '/group/member', { params });
    } catch {
      break;
    }

    const values = Array.isArray(data?.values) ? data.values : [];
    members.push(...values);

    const nextStartAt = Number(data?.startAt || 0) + Number(data?.maxResults || values.length || 0);
    const total = Number(data?.total || members.length);
    hasMore = data?.isLast === false || nextStartAt < total;
    startAt = nextStartAt;
    if (values.length === 0) hasMore = false;
  }

  return members;
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

const jiraSearchAllIssues = async ({ client, jql, fields = [], pageSize = 200, maxPages = 100 }) => {
  const allIssues = [];
  let startAt = 0;
  let page = 0;
  let total = 0;

  while (page < maxPages) {
    const data = await jiraSearch({
      client,
      jql,
      startAt,
      maxResults: pageSize,
      fields,
    });

    const issues = Array.isArray(data?.issues) ? data.issues : [];
    const currentStartAt = Number(data?.startAt ?? startAt) || startAt;
    const pageMaxResults = Number(data?.maxResults ?? pageSize) || pageSize;
    total = Number(data?.total ?? total) || total;

    allIssues.push(...issues);

    const nextStartAt = currentStartAt + (issues.length || pageMaxResults);
    const reachedEndByTotal = total > 0 && nextStartAt >= total;
    const reachedEndByCount = issues.length < pageMaxResults;

    if (issues.length === 0 || reachedEndByTotal || reachedEndByCount) {
      break;
    }

    startAt = nextStartAt;
    page += 1;
  }

  return {
    startAt: 0,
    maxResults: allIssues.length,
    total: total || allIssues.length,
    issues: allIssues,
  };
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
    toIdString(project.owner) === user.id ||
    project.members.some((m) => toIdString(m?.user) === user.id);

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
  // gh-epic-link is for Company-managed. Team-managed will use the 'parent' field.
  const epicLinkField = jiraFields.find((f) => (f.schema?.custom || '').includes('gh-epic-link'))?.id;
  
  const results = { epics: [], stories: [], errors: [] };
  const localToJiraKeyMap = new Map(); // Tracks keys created in this specific run to immediately link children

  // 1. PUSH EPICS FIRST
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
        await Epic.findByIdAndUpdate(epicId, { pushedToJira: true, pushedAt: new Date(), status: 'approved' });
        results.epics.push({ id: epicId, jiraKey: epic.jiraEpicKey, action: 'updated' });
        localToJiraKeyMap.set(epicId.toString(), epic.jiraEpicKey);
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
        localToJiraKeyMap.set(epicId.toString(), response.data.key);
      }
    } catch (err) {
      results.errors.push({ id: epicId, type: 'epic', error: err.response?.data?.errorMessages?.[0] || err.message });
    }
  }

  // 2. FETCH AND SORT STORIES & TASKS (Parents first, Children second)
  const allStories = await Story.find({ _id: { $in: storyIds || [] } })
    .populate('epic')
    .populate('assignee', 'email jiraEmail')
    .populate('parentStory', 'jiraIssueKey title');

  // Splitting ensures we push Stories before their Sub-tasks
  const parentIssues = allStories.filter(s => !s.parentStory);
  const childIssues = allStories.filter(s => !!s.parentStory);
  const sortedStories = [...parentIssues, ...childIssues];

  // 3. PUSH STORIES & TASKS IN CORRECT ORDER
  for (const story of sortedStories) {
    try {
      const acText = (story.acceptanceCriteria || []).map((a) => `- ${a.criterion}`).join('\n');
      const isChild = !!story.parentStory;
      
      // Force Sub-task if it has a parent. Otherwise use its native type.
      const issueTypeName = isChild ? 'Sub-task' : (story.type === 'task' ? 'Task' : (story.type === 'bug' ? 'Bug' : 'Story'));

      const payload = {
        fields: {
          project: { key: project.jiraProjectKey },
          summary: story.title,
          description: toAdfText(acText ? `${story.description || ''}\n\nAcceptance Criteria:\n${acText}` : story.description || ''),
          issuetype: { name: issueTypeName },
          priority: { name: capitalize(story.priority || 'medium') },
        },
      };

      if (storyPointsField && story.storyPoints) payload.fields[storyPointsField] = story.storyPoints;
      if (story.dueDate) payload.fields.duedate = new Date(story.dueDate).toISOString().slice(0, 10);
      if (story.startDate) {
        const startDateValue = new Date(story.startDate).toISOString().slice(0, 10);
        payload.fields.labels = [...new Set([...(payload.fields.labels || []), `start_date_${startDateValue}`])];
      }

      // Assignee lookup
      const assigneeEmail = story.assignee?.jiraEmail || story.assignee?.email;
      if (assigneeEmail) {
        try {
          const assignees = await jiraRequest(client, 'get', '/user/search', { params: { query: assigneeEmail, maxResults: 10 } });
          const match = (assignees || []).find((u) => (u?.emailAddress || '').toLowerCase() === assigneeEmail.toLowerCase());
          if (match?.accountId) payload.fields.assignee = { accountId: match.accountId };
        } catch { /* Ignore lookup failures */ }
      }

      // HIERARCHY MAPPING: Link to Epic OR Link to Parent Story
      if (isChild) {
        // It's a Sub-task: Link to Parent Story
        const parentDoc = story.parentStory;
        const parentMongoId = parentDoc?._id?.toString?.() || (typeof parentDoc === 'string' ? parentDoc : '');
        const resolvedParentKey = (parentDoc && typeof parentDoc === 'object' ? parentDoc.jiraIssueKey : null)
          || localToJiraKeyMap.get(parentMongoId);
        console.log(`[SUBTASK] ${story.title} → parentStory populated=${!!parentDoc} mongoId=${parentMongoId} resolvedKey=${resolvedParentKey}`);
        if (resolvedParentKey) payload.fields.parent = { key: resolvedParentKey };
        else console.log(`❌ [SUBTASK] No parent key resolved for ${story.title}`);
      } else if (story.epic) {
        // It's a standard Story/Task: Link to Epic
        const resolvedEpicKey = story.epic.jiraEpicKey || localToJiraKeyMap.get(story.epic._id.toString());
        if (!resolvedEpicKey) {
          console.log(`❌ No Epic Key Found For: ${story.title}`);
        }
        if (resolvedEpicKey) {
          if (epicLinkField) {
            payload.fields[epicLinkField] = resolvedEpicKey; // Company-managed
          } else {
            payload.fields.parent = { key: resolvedEpicKey }; // Team-managed fallback
          }
        }
      }

      // Execute Create or Update
      let currentJiraKey = story.jiraIssueKey || '';
      if (story.jiraIssueKey) {
        await axios.put(`${client.baseURL}/issue/${story.jiraIssueKey}`, { fields: payload.fields }, { auth: client.auth });
        await Story.findByIdAndUpdate(story._id, { pushedToJira: true, pushedAt: new Date() });
        results.stories.push({ id: story._id, jiraKey: story.jiraIssueKey, action: 'updated' });
        localToJiraKeyMap.set(story._id.toString(), story.jiraIssueKey);
      } else {
        const response = await axios.post(`${client.baseURL}/issue`, payload, { auth: client.auth });
        currentJiraKey = response.data.key;
        await Story.findByIdAndUpdate(story._id, {
          jiraIssueId: response.data.id,
          jiraIssueKey: response.data.key,
          pushedToJira: true,
          pushedAt: new Date(),
          status: 'to_do',
        });
        results.stories.push({ id: story._id, jiraKey: currentJiraKey, action: 'created' });
        localToJiraKeyMap.set(story._id.toString(), currentJiraKey);
      }
    } catch (err) {
      results.errors.push({ id: story._id, type: 'story', error: err.response?.data?.errorMessages?.[0] || err.message });
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
  try {
    const client = await getJiraClient(req.user.id);
    const data = await jiraRequest(client, 'get', '/project/search', {
      params: { maxResults: 100 },
    });
    return res.status(200).json({ success: true, data: data.values || [] });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.toLowerCase().includes('jira credentials not configured')) {
      return res.status(200).json({
        success: true,
        data: [],
        integration: {
          jiraConfigured: false,
          message: 'Jira credentials not configured for this user yet.',
        },
      });
    }
    throw error;
  }
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

// @desc    List Jira project members by role
// @route   GET /api/jira/server/projects/:projectIdOrKey/members
// @access  Private
const listServerProjectMembers = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const { projectIdOrKey } = req.params;
  const includeApps = String(req.query.includeApps || 'false').toLowerCase() === 'true';
  const includeGroups = String(req.query.includeGroups || 'true').toLowerCase() !== 'false';

  let roleMap = {};
  try {
    roleMap = await jiraRequest(client, 'get', `/project/${projectIdOrKey}/role`);
  } catch (roleError) {
    // If role endpoint fails due to permissions, log and continue to fallback
    logger.warn(`Failed to fetch roles for project ${projectIdOrKey}: ${roleError.message}. Using fallback approach.`);
    roleMap = {};
  }

  const roleEntries = Object.entries(roleMap || {});

  const memberMap = new Map();
  const roles = [];

  for (const [roleName, roleUrl] of roleEntries) {
    if (!includeApps && roleName.toLowerCase() === 'atlassian-addons-project-access') {
      continue;
    }

    const rolePath = parseJiraPathFromUrl(roleUrl);
    if (!rolePath) continue;

    const roleData = await jiraRequest(client, 'get', rolePath);
    const rawActors = Array.isArray(roleData?.actors) ? roleData.actors : [];
    const actors = includeApps
      ? rawActors
      : rawActors.filter((actor) => isUserRoleActor(actor) || actor?.type === 'atlassian-group-role-actor');
    roles.push({
      id: roleData?.id,
      name: roleData?.name || roleName,
      actorCount: actors.length,
    });

    actors.forEach((actor) => {
      if (!isUserRoleActor(actor)) return;

      const user = {
        ...(actor?.actorUser || {}),
        accountId: actor?.accountId,
        displayName: actor?.actorUser?.displayName || actor?.displayName || actor?.name,
        emailAddress: actor?.actorUser?.emailAddress || actor?.emailAddress,
        accountType: actor?.accountType,
      };
      const item = buildMemberFromUser(user, roleName);
      const key = item.accountId || `${roleName}:${item.name}`;

      if (!memberMap.has(key)) {
        memberMap.set(key, item);
      }

      const existing = memberMap.get(key);
      if (!existing.roles.includes(roleName)) {
        existing.roles.push(roleName);
      }
    });

    if (includeGroups) {
      const groupActors = actors.filter((actor) => actor?.type === 'atlassian-group-role-actor');
      for (const groupActor of groupActors) {
        const groupMembers = await fetchGroupMembers(client, groupActor?.actorGroup);
        groupMembers.forEach((user) => {
          const item = buildMemberFromUser(user, roleName);
          const key = item.accountId || `${roleName}:${item.name}`;
          if (!memberMap.has(key)) {
            memberMap.set(key, item);
          }
          const existing = memberMap.get(key);
          if (!existing.roles.includes(roleName)) {
            existing.roles.push(roleName);
          }
        });
      }
    }
  }

  // Fallback: if role-based resolution returns no people, pull assignable users for the project.
  if (memberMap.size === 0) {
    let assignableUsers = [];
    try {
      assignableUsers = await jiraRequest(client, 'get', '/user/assignable/search', {
        params: {
          project: projectIdOrKey,
          maxResults: 100,
        },
      });
    } catch {
      assignableUsers = [];
    }

    if (Array.isArray(assignableUsers)) {
      assignableUsers.forEach((user) => {
        const item = buildMemberFromUser(user, 'assignable_user');
        const key = item.accountId || `assignable:${item.name}`;
        if (!memberMap.has(key)) {
          memberMap.set(key, item);
        }
      });
    }
  }

  res.status(200).json({
    success: true,
    data: {
      projectIdOrKey,
      memberCount: memberMap.size,
      members: [...memberMap.values()],
      roles,
    },
  });
};

// @desc    Get Jira active sprint and sprint timeline for a project key
// @route   GET /api/jira/server/projects/:projectIdOrKey/active-sprint
// @access  Private
const getServerProjectActiveSprint = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const { projectIdOrKey } = req.params;

  const boardSearch = await jiraAgileRequest(client, 'get', '/board', {
    params: {
      projectKeyOrId: projectIdOrKey,
      type: 'scrum',
      maxResults: 50,
    },
  });

  const boards = Array.isArray(boardSearch?.values) ? boardSearch.values : [];
  const board = boards[0] || null;

  if (!board) {
    return res.status(200).json({
      success: true,
      data: {
        projectKey: projectIdOrKey,
        board: null,
        activeSprint: null,
        sprints: [],
        activeIssues: [],
      },
    });
  }

  const allSprints = [];
  let startAt = 0;
  let done = false;

  while (!done) {
    const sprintPage = await jiraAgileRequest(client, 'get', `/board/${board.id}/sprint`, {
      params: {
        state: 'active,closed,future',
        startAt,
        maxResults: 50,
      },
    });

    const pageValues = Array.isArray(sprintPage?.values) ? sprintPage.values : [];
    allSprints.push(...pageValues);

    const pageStartAt = Number(sprintPage?.startAt || startAt);
    const pageMaxResults = Number(sprintPage?.maxResults || 50);
    const isLast = sprintPage?.isLast === true;
    const nextStartAt = pageStartAt + pageValues.length;

    done = isLast || pageValues.length < pageMaxResults;
    startAt = nextStartAt;

    if (pageValues.length === 0) done = true;
  }

  const activeSprint = allSprints.find((s) => s?.state?.toLowerCase() === 'active') || null;

  let activeIssues = [];
  if (activeSprint?.id) {
    let issueStartAt = 0;
    let issueDone = false;

    while (!issueDone) {
      const issuePage = await jiraAgileRequest(client, 'get', `/board/${board.id}/sprint/${activeSprint.id}/issue`, {
        params: {
          startAt: issueStartAt,
          maxResults: 100,
          fields: 'summary,status,assignee,priority,issuetype,updated',
        },
      });

      const pageIssues = Array.isArray(issuePage?.issues) ? issuePage.issues : [];
      activeIssues.push(...pageIssues);

      const pageStartAt = Number(issuePage?.startAt || issueStartAt);
      const pageMaxResults = Number(issuePage?.maxResults || 100);
      const total = Number(issuePage?.total || activeIssues.length);
      const nextStartAt = pageStartAt + pageIssues.length;

      issueDone = pageIssues.length === 0 || nextStartAt >= total || pageIssues.length < pageMaxResults;
      issueStartAt = nextStartAt;
    }
  }

  res.status(200).json({
    success: true,
    data: {
      projectKey: projectIdOrKey,
      board: {
        id: board.id,
        name: board.name,
        type: board.type,
      },
      activeSprint,
      sprints: allSprints,
      activeIssues,
    },
  });
};

// @desc    List Jira issues by project/JQL
// @route   GET /api/jira/server/issues
// @access  Private
const listServerIssues = async (req, res) => {
  const { projectKey, jql, maxResults = 100, startAt = 0 } = req.query;
  const client = await getJiraClient(req.user.id);
  const resolvedJql = jql || (projectKey ? `project=${projectKey} ORDER BY updated DESC` : 'ORDER BY updated DESC');

  const fetchAll = String(req.query.fetchAll || 'false').toLowerCase() === 'true';
  const requestedFields = String(req.query.fields || '').trim();
  const fields = requestedFields
    ? requestedFields.split(',').map((field) => field.trim()).filter(Boolean)
    : ['summary', 'description', 'priority', 'status', 'issuetype', 'parent', 'project', 'assignee', 'updated'];

  const data = fetchAll
    ? await jiraSearchAllIssues({
        client,
        jql: resolvedJql,
        fields,
        pageSize: Number(maxResults) || 200,
      })
    : await jiraSearch({
        client,
        jql: resolvedJql,
        startAt,
        maxResults,
        fields,
      });

  res.status(200).json({ success: true, data });
};

// @desc    Get Jira issue detail
// @route   GET /api/jira/server/issues/:issueKey
// @access  Private
const getServerIssue = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const params = {};
  if (req.query.expand) {
    params.expand = req.query.expand;
  } else {
    params.expand = 'names,renderedFields';
  }
  if (req.query.fields) {
    params.fields = req.query.fields;
  }

  const data = await jiraRequest(client, 'get', `/issue/${req.params.issueKey}`, { params });
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
  const { summary, description, priority, issueType, labels, dueDate, assigneeAccountId } = req.body;
  const fields = {};
  if (summary !== undefined) fields.summary = summary;
  if (description !== undefined) fields.description = toAdfText(description || '');
  if (priority !== undefined) fields.priority = { name: priority };
  if (issueType !== undefined) fields.issuetype = { name: issueType };
  if (Array.isArray(labels)) fields.labels = labels;
  if (dueDate !== undefined) fields.duedate = dueDate || null;
  if (assigneeAccountId !== undefined) {
    fields.assignee = assigneeAccountId ? { accountId: assigneeAccountId } : null;
  }

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

// @desc    Purge all Jira issues for a project
// @route   DELETE /api/jira/server/issues/purge/:projectKey
// @access  Private
const purgeServerIssues = async (req, res) => {
  const { projectKey } = req.params;
  const client = await getJiraClient(req.user.id);

  // Fetch all issue keys for the project
  const searchData = await jiraSearchAllIssues({
    client,
    jql: `project=${projectKey} ORDER BY created DESC`,
    fields: ['key'],
    pageSize: 200,
  });

  const issueKeys = (searchData?.issues || []).map((issue) => issue.key);
  if (!issueKeys.length) {
    return res.status(200).json({ success: true, message: 'No issues to delete', deleted: 0, failed: 0 });
  }

  // Delete one by one sequentially (Jira rate-limits bulk deletes)
  let deleted = 0;
  let failed = 0;
  const failures = [];
  for (const key of issueKeys) {
    try {
      await jiraRequest(client, 'delete', `/issue/${key}`);
      deleted++;
    } catch (err) {
      failed++;
      failures.push({ key, error: err.message });
    }
  }

  res.status(200).json({
    success: true,
    message: `Purged ${deleted}/${issueKeys.length} Jira issues from project ${projectKey}`,
    deleted,
    failed,
    total: issueKeys.length,
    failures: failures.slice(0, 10),
  });
};

// @desc    List transitions for Jira issue
// @route   GET /api/jira/server/issues/:issueKey/transitions
// @access  Private
const listServerIssueTransitions = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const data = await jiraRequest(client, 'get', `/issue/${req.params.issueKey}/transitions`);
  res.status(200).json({ success: true, data: data?.transitions || [] });
};

// @desc    Assign Jira issue to current user
// @route   POST /api/jira/server/issues/:issueKey/assign-me
// @access  Private
const assignServerIssueToMe = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const me = await jiraRequest(client, 'get', '/myself');
  if (!me?.accountId) {
    return res.status(400).json({ success: false, message: 'Could not resolve current Jira account.' });
  }

  await jiraRequest(client, 'put', `/issue/${req.params.issueKey}/assignee`, {
    data: { accountId: me.accountId },
  });
  res.status(200).json({ success: true, message: 'Issue assigned to you' });
};

// @desc    Create Jira issue comment
// @route   POST /api/jira/server/issues/:issueKey/comments
// @access  Private
const createServerIssueComment = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const { body } = req.body;
  if (!body || !String(body).trim()) {
    return res.status(400).json({ success: false, message: 'Comment body is required' });
  }

  const data = await jiraRequest(client, 'post', `/issue/${req.params.issueKey}/comment`, {
    data: { body: toAdfText(String(body).trim()) },
  });
  res.status(201).json({ success: true, data, message: 'Comment added' });
};

// @desc    Update Jira issue comment
// @route   PUT /api/jira/server/issues/:issueKey/comments/:commentId
// @access  Private
const updateServerIssueComment = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const { body } = req.body;
  if (!body || !String(body).trim()) {
    return res.status(400).json({ success: false, message: 'Comment body is required' });
  }

  const data = await jiraRequest(client, 'put', `/issue/${req.params.issueKey}/comment/${req.params.commentId}`, {
    data: { body: toAdfText(String(body).trim()) },
  });
  res.status(200).json({ success: true, data, message: 'Comment updated' });
};

// @desc    Delete Jira issue comment
// @route   DELETE /api/jira/server/issues/:issueKey/comments/:commentId
// @access  Private
const deleteServerIssueComment = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  await jiraRequest(client, 'delete', `/issue/${req.params.issueKey}/comment/${req.params.commentId}`);
  res.status(200).json({ success: true, message: 'Comment deleted' });
};

// @desc    Create subtask under Jira issue
// @route   POST /api/jira/server/issues/:issueKey/subtasks
// @access  Private
const createServerIssueSubtask = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const { summary, description = '' } = req.body;
  if (!summary || !String(summary).trim()) {
    return res.status(400).json({ success: false, message: 'Subtask summary is required' });
  }

  const parentIssue = await jiraRequest(client, 'get', `/issue/${req.params.issueKey}`, {
    params: { fields: 'project' },
  });

  const data = await jiraRequest(client, 'post', '/issue', {
    data: {
      fields: {
        project: { key: parentIssue?.fields?.project?.key },
        parent: { key: req.params.issueKey },
        summary: String(summary).trim(),
        description: toAdfText(description),
        issuetype: { name: 'Sub-task' },
      },
    },
  });

  res.status(201).json({ success: true, data, message: 'Subtask created' });
};

// @desc    Delete Jira subtask
// @route   DELETE /api/jira/server/issues/:issueKey/subtasks/:subtaskKey
// @access  Private
const deleteServerIssueSubtask = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  await jiraRequest(client, 'delete', `/issue/${req.params.subtaskKey}`);
  res.status(200).json({ success: true, message: 'Subtask deleted' });
};

// @desc    Create Jira issue link
// @route   POST /api/jira/server/issues/:issueKey/links
// @access  Private
const createServerIssueLink = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  const { linkedIssueKey, linkTypeName = 'Relates', direction = 'outward' } = req.body;
  if (!linkedIssueKey || !String(linkedIssueKey).trim()) {
    return res.status(400).json({ success: false, message: 'linkedIssueKey is required' });
  }

  const data = {
    type: { name: linkTypeName },
    outwardIssue: { key: req.params.issueKey },
    inwardIssue: { key: String(linkedIssueKey).trim().toUpperCase() },
  };

  if (String(direction).toLowerCase() === 'inward') {
    data.outwardIssue = { key: String(linkedIssueKey).trim().toUpperCase() };
    data.inwardIssue = { key: req.params.issueKey };
  }

  await jiraRequest(client, 'post', '/issueLink', { data });
  res.status(201).json({ success: true, message: 'Issue link created' });
};

// @desc    Delete Jira issue link
// @route   DELETE /api/jira/server/issue-links/:linkId
// @access  Private
const deleteServerIssueLink = async (req, res) => {
  const client = await getJiraClient(req.user.id);
  await jiraRequest(client, 'delete', `/issueLink/${req.params.linkId}`);
  res.status(200).json({ success: true, message: 'Issue link removed' });
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

  const aiUrl = resolveAiServiceBaseUrl(process.env.AI_SERVICE_URL);
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const { data } = await axios.post(
      `${aiUrl}/jira/summarize`,
      {
        project_key: projectKey,
        issues,
        ai_config: aiConfig,
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
  const search = await jiraSearchAllIssues({
    client,
    jql: `project=${project.jiraProjectKey} ORDER BY updated DESC`,
    pageSize: 200,
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
  listServerProjectMembers,
  getServerProjectActiveSprint,
  listServerIssues,
  getServerIssue,
  createServerIssue,
  updateServerIssue,
  deleteServerIssue,
  purgeServerIssues,
  listServerIssueTransitions,
  transitionServerIssue,
  assignServerIssueToMe,
  createServerIssueComment,
  updateServerIssueComment,
  deleteServerIssueComment,
  createServerIssueSubtask,
  deleteServerIssueSubtask,
  createServerIssueLink,
  deleteServerIssueLink,
  jiraProxy,
  syncFromJira,
  getJiraAISummary,
};
