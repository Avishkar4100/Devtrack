const Project = require('../models/Project');
const Story = require('../models/Story');
const Commit = require('../models/Commit');
const User = require('../models/User');
const axios = require('axios');
const aiService = require('../services/aiService');
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

const doneStatuses = new Set(['done']);
const inProgressStatuses = new Set(['in_progress', 'in_review']);
const notStartedStatuses = new Set(['draft', 'approved', 'to_do']);

const normalizeJiraDomain = (domain = '') => {
  const raw = String(domain || '').trim().replace(/^"|"$/g, '');
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

const escapeHtml = (text = '') => String(text || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const stripPotentiallyUnsafeHtml = (html = '') => String(html || '')
  .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
  .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
  .replace(/on\w+\s*=\s*'[^']*'/gi, '')
  .replace(/javascript:/gi, '');

const parseJiraDescription = (description) => {
  if (!description) return '';
  if (typeof description === 'string') return description;
  const walk = (node) => {
    if (!node) return '';
    if (Array.isArray(node)) return node.map(walk).join(' ');
    if (typeof node === 'string') return node;
    if (node.type === 'text') return node.text || '';
    return walk(node.content);
  };
  return walk(description).replace(/\s+/g, ' ').trim();
};

const extractJiraKeysFromText = (text = '') => {
  const keyRegex = /\b[A-Z][A-Z0-9]+-\d+\b/g;
  return String(text || '').match(keyRegex) || [];
};

const extractTestPassRate = (messages = []) => {
  for (const message of messages) {
    const match = String(message || '').match(/(\d+)\s*\/\s*(\d+)\s*tests?\s*passed/i);
    if (!match) continue;
    const passed = Number(match[1] || 0);
    const total = Number(match[2] || 0);
    if (!total) continue;
    const pct = Math.round((passed / total) * 100);
    return `${passed}/${total} (${pct}%)`;
  }
  return 'N/A';
};

const storyIssueKey = (story, index = 0) => {
  return String(story?.jiraIssueKey || story?.storyKey || `LOCAL-${index + 1}`).trim();
};

const normalizeIssue = (story, index = 0, linkedCommits = [], source = 'local') => ({
  key: storyIssueKey(story, index),
  title: String(story?.title || 'Untitled issue').trim(),
  description: String(story?.description || '').trim(),
  status: String(story?.status || 'draft').toLowerCase(),
  type: String(story?.type || 'story'),
  priority: String(story?.priority || 'medium'),
  storyPoints: Number(story?.storyPoints || 0),
  assignee: story?.assignee?.name || story?.assignee || 'Unassigned',
  reporter: story?.reporter?.name || story?.reporter || 'Unknown',
  epic: story?.epic?.title || story?.epic || 'General',
  parent: story?.parentStory?.title || story?.parent || null,
  commentsCount: Number(story?.commentsCount || (Array.isArray(story?.comments) ? story.comments.length : 0)),
  linkedCommitCount: linkedCommits.length,
  linkedCommitMessages: linkedCommits.slice(0, 6).map((c) => String(c?.message || '').trim()).filter(Boolean),
  linkedCommitHashes: linkedCommits.slice(0, 6).map((c) => String(c?.sha || '')).filter(Boolean),
  linkedTestPassRate: extractTestPassRate(linkedCommits.map((c) => c?.message)),
  updatedAt: story?.updatedAt || story?.createdAt || null,
  source,
});

const jiraIssueToNormalized = (issue = {}, linkedCommits = [], index = 0) => {
  const fields = issue.fields || {};
  const issueType = String(fields?.issuetype?.name || 'Story').toLowerCase();
  const localType = issueType.includes('task')
    ? 'task'
    : issueType.includes('bug')
      ? 'bug'
      : issueType.includes('sub')
        ? 'subtask'
        : 'story';
  const statusName = String(fields?.status?.name || '').toLowerCase();
  let status = 'to_do';
  if (statusName.includes('done') || statusName.includes('closed') || statusName.includes('resolved')) status = 'done';
  else if (statusName.includes('review') || statusName.includes('progress') || statusName.includes('develop')) status = 'in_progress';

  const priorityName = String(fields?.priority?.name || 'medium').toLowerCase();

  return normalizeIssue({
    jiraIssueKey: issue.key || `JIRA-${index + 1}`,
    title: fields?.summary || issue.key || `Issue ${index + 1}`,
    description: parseJiraDescription(fields?.description),
    status,
    type: localType,
    priority: priorityName,
    assignee: fields?.assignee?.displayName || 'Unassigned',
    reporter: fields?.reporter?.displayName || 'Unknown',
    epic: fields?.parent?.key || 'General',
    commentsCount: Number(fields?.comment?.total || 0),
    updatedAt: fields?.updated || fields?.created || null,
  }, index, linkedCommits, 'jira');
};

const fetchJiraBacklogIssues = async ({ userId, jiraProjectKey }) => {
  if (!jiraProjectKey) return [];

  const user = await User.findById(userId).select('+jiraApiToken jiraEmail jiraDomain');
  if (!user?.jiraApiToken || !user?.jiraEmail || !user?.jiraDomain) return [];

  const jiraDomain = normalizeJiraDomain(user.jiraDomain);
  if (!jiraDomain) return [];

  const auth = {
    username: user.jiraEmail,
    password: user.jiraApiToken,
  };
  const baseURL = `https://${jiraDomain}/rest/api/3`;

  const allIssues = [];
  let startAt = 0;
  const maxResults = 100;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page += 1) {
    const { data } = await axios.get(`${baseURL}/search`, {
      auth,
      params: {
        jql: `project=${jiraProjectKey} ORDER BY updated DESC`,
        startAt,
        maxResults,
        fields: 'summary,description,priority,status,issuetype,assignee,reporter,parent,updated,created,comment',
      },
      timeout: 30000,
    });

    const issues = Array.isArray(data?.issues) ? data.issues : [];
    allIssues.push(...issues);

    const total = Number(data?.total || allIssues.length);
    startAt += issues.length;
    if (issues.length === 0 || startAt >= total) break;
  }

  return allIssues;
};

const buildFallbackInsightText = ({ totals, doneIssues, inProgressIssues, notStartedIssues }) => {
  const topDone = doneIssues[0]
    ? `${doneIssues[0].key} is complete with ${doneIssues[0].linkedCommitCount} linked commits.`
    : 'No completed issue is trace-verified yet.';
  const topRisk = inProgressIssues[0]
    ? `${inProgressIssues[0].key} is currently in progress and should be unblocked next.`
    : notStartedIssues[0]
      ? `${notStartedIssues[0].key} is not started and should be planned.`
      : 'No immediate risk item detected.';

  return `Execution-first review: ${totals.done}/${totals.total} issues are done (${totals.completionPct}%). ${totals.commitCoveragePct}% of done issues are commit-traced and comment coverage is ${totals.commentCoveragePct}%. ${topDone} ${topRisk}`;
};

const buildExecutionFirstPrompt = ({ projectName, jiraIssueCount, commitCount, doneIssues, inProgressIssues, notStartedIssues, commits, totals }) => {
  const doneBlock = doneIssues
    .slice(0, 24)
    .map((item) => `- ${item.key} | ${item.title} | owner=${item.assignee} | commits=${item.linkedCommitCount} | comments=${item.commentsCount}`)
    .join('\n');
  const inProgressBlock = inProgressIssues
    .slice(0, 24)
    .map((item) => `- ${item.key} | ${item.title} | owner=${item.assignee} | priority=${item.priority}`)
    .join('\n');
  const notStartedBlock = notStartedIssues
    .slice(0, 24)
    .map((item) => `- ${item.key} | ${item.title} | owner=${item.assignee} | priority=${item.priority}`)
    .join('\n');
  const commitBlock = commits
    .slice(0, 40)
    .map((c) => `- ${(c.sha || '').slice(0, 10)} | ${c.author || 'Unknown'} | ${c.message || ''}`)
    .join('\n');

  return [
    'Switch to Execution-First Logic. Ignore empty requirement baseline when discrepancy is detected.',
    `Cross-reference Jira Backlog (${jiraIssueCount} issues) with Recent GitHub Activity (${commitCount} commits).`,
    'Map issues to commits using Jira keys in commit messages and validate like a strict scrum master.',
    'Return plain text only (no markdown, no html) in 4-6 concise sentences focusing on delivery health, traceability, and top unblock priority.',
    `Project: ${projectName}`,
    `Totals: total=${totals.total}, done=${totals.done}, in_progress=${totals.inProgress}, not_started=${totals.notStarted}, completion_pct=${totals.completionPct}, traceability_pct=${totals.commitCoveragePct}, comment_coverage_pct=${totals.commentCoveragePct}`,
    'Done issues:',
    doneBlock || '- none',
    'In progress issues:',
    inProgressBlock || '- none',
    'Not started issues:',
    notStartedBlock || '- none',
    'Recent commit messages:',
    commitBlock || '- none',
  ].join('\n');
};

const buildHtmlDashboard = ({ projectName, totals, doneIssues, summary, recentCommitsCount }) => {
  const completionWidth = Math.max(0, Math.min(100, Number(totals?.completionPct || 0)));
  const doneRows = doneIssues.slice(0, 10).map((issue) => {
    const hash = issue.linkedCommitHashes?.[0] ? issue.linkedCommitHashes[0].slice(0, 10) : 'N/A';
    return `
      <tr class="border-b border-gray-200">
        <td class="py-2 pr-2 font-semibold text-gray-700">${escapeHtml(issue.key)}</td>
        <td class="py-2 pr-2 text-gray-600">${escapeHtml(issue.title)}</td>
        <td class="py-2 pr-2 text-gray-600">${escapeHtml(hash)}</td>
        <td class="py-2 text-gray-600">${escapeHtml(issue.linkedTestPassRate || 'N/A')}</td>
      </tr>`;
  }).join('');

  const safeSummary = escapeHtml(summary || 'No AI insight available yet.');

  return stripPotentiallyUnsafeHtml(`
<div class="p-4 bg-gray-50 rounded-xl border border-gray-200">
  <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-3 pb-4 border-b border-gray-200">
    <h2 class="text-xl font-bold text-gray-800">${escapeHtml(projectName)} Executive Delivery Snapshot</h2>
    <span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">SYNC ACTIVE</span>
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-4">
    <div class="bg-white p-3 rounded shadow-sm border-t-4 border-blue-500">
      <p class="text-xs text-gray-500 uppercase">Total Issues</p>
      <p class="text-2xl font-black text-gray-900">${totals.total}</p>
    </div>
    <div class="bg-white p-3 rounded shadow-sm border-t-4 border-green-500">
      <p class="text-xs text-gray-500 uppercase">Done</p>
      <p class="text-2xl font-black text-gray-900">${totals.done}</p>
    </div>
    <div class="bg-white p-3 rounded shadow-sm border-t-4 border-purple-500">
      <p class="text-xs text-gray-500 uppercase">Completion</p>
      <p class="text-2xl font-black text-gray-900">${totals.completionPct}%</p>
    </div>
    <div class="bg-white p-3 rounded shadow-sm border-t-4 border-emerald-600">
      <p class="text-xs text-gray-500 uppercase">Traceability</p>
      <p class="text-2xl font-black text-gray-900">${totals.commitCoveragePct}%</p>
    </div>
  </div>

  <div class="mb-4">
    <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
      <span>Overall Progress</span>
      <span>${totals.done}/${totals.total} done • ${recentCommitsCount} recent commits</span>
    </div>
    <div class="w-full h-3 rounded-full bg-gray-200 overflow-hidden">
      <div class="h-3 bg-gradient-to-r from-blue-500 to-emerald-500" style="width:${completionWidth}%"></div>
    </div>
  </div>

  <div class="bg-white rounded-lg border border-gray-200 p-3 mb-4 overflow-auto">
    <h3 class="text-sm font-bold text-gray-800 mb-2">Latest Done Stories with Commit Trace</h3>
    <table class="w-full text-xs min-w-[560px]">
      <thead>
        <tr class="border-b border-gray-200 text-left text-gray-500 uppercase">
          <th class="py-2 pr-2">Issue Key</th>
          <th class="py-2 pr-2">Title</th>
          <th class="py-2 pr-2">Commit Hash</th>
          <th class="py-2">Test Pass Rate</th>
        </tr>
      </thead>
      <tbody>
        ${doneRows || '<tr><td class="py-2 text-gray-500" colspan="4">No done issues available yet.</td></tr>'}
      </tbody>
    </table>
  </div>

  <div class="bg-slate-900 text-white p-4 rounded-lg border border-slate-700">
    <h3 class="text-cyan-300 font-bold mb-2">🤖 AI Scrum Master Insight</h3>
    <p class="text-sm leading-relaxed text-slate-200">${safeSummary}</p>
  </div>
</div>`);
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

// @desc    Get Scrum-master markdown insights for Delivery Snapshot
// @route   GET /api/insights/:projectId/scrum-markdown
// @access  Private
const generateScrumMarkdownInsightsController = async (req, res) => {
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
  const isMember = req.user.role === 'admin' || ownerId === req.user.id || memberIds.includes(req.user.id);

  if (!isMember) {
    return res.status(403).json({ success: false, message: 'Not authorized to view this project insights' });
  }

  const [stories, commits] = await Promise.all([
    Story.find({ project: projectId })
      .populate('assignee', 'name email')
      .populate('reporter', 'name email')
      .populate('epic', 'title')
      .populate('parentStory', 'title')
      .sort({ updatedAt: -1 })
      .lean(),
    Commit.find({ projectId }).sort({ date: -1 }).limit(300).lean(),
  ]);

  let jiraIssues = [];
  try {
    jiraIssues = await fetchJiraBacklogIssues({ userId: req.user.id, jiraProjectKey: project.jiraProjectKey });
  } catch (_) {
    jiraIssues = [];
  }

  const commitsByIssueKey = new Map();
  commits.forEach((commit) => {
    const message = String(commit?.message || '');
    const matches = extractJiraKeysFromText(message);
    matches.forEach((key) => {
      const list = commitsByIssueKey.get(key) || [];
      list.push(commit);
      commitsByIssueKey.set(key, list);
    });
  });

  const baselineDiscrepancy = stories.length === 0 && jiraIssues.length > 0;
  const useJiraExecutionFirst = jiraIssues.length > 0;

  const allIssues = useJiraExecutionFirst
    ? jiraIssues.map((issue, index) => {
      const key = String(issue?.key || `JIRA-${index + 1}`);
      const linked = commitsByIssueKey.get(key) || [];
      return jiraIssueToNormalized(issue, linked, index);
    })
    : stories.map((story, index) => {
      const key = storyIssueKey(story, index);
      const linked = commitsByIssueKey.get(key) || [];
      return normalizeIssue(story, index, linked, 'local');
    });

  const doneIssues = allIssues.filter((item) => doneStatuses.has(item.status));
  const inProgressIssues = allIssues.filter((item) => inProgressStatuses.has(item.status));
  const notStartedIssues = allIssues.filter((item) => notStartedStatuses.has(item.status));

  const total = allIssues.length;
  const done = doneIssues.length;
  const inProgress = inProgressIssues.length;
  const notStarted = notStartedIssues.length;
  const completionPct = total ? Math.round((done / total) * 100) : 0;
  const commentCoveragePct = total
    ? Math.round((allIssues.filter((item) => item.commentsCount > 0).length / total) * 100)
    : 0;
  const doneWithTrace = doneIssues.filter((item) => item.linkedCommitCount > 0).length;
  const commitCoveragePct = done ? Math.round((doneWithTrace / done) * 100) : 0;

  const totals = {
    total,
    done,
    inProgress,
    notStarted,
    completionPct,
    commentCoveragePct,
    commitCoveragePct,
  };

  const recentCommits = commits.slice(0, 13);
  const prompt = buildExecutionFirstPrompt({
    projectName: project.name,
    jiraIssueCount: jiraIssues.length,
    commitCount: recentCommits.length,
    doneIssues,
    inProgressIssues,
    notStartedIssues,
    commits: recentCommits,
    totals,
  });

  let summaryText = '';
  try {
    const aiResult = await aiService.testLLM({ prompt });
    summaryText = String(aiResult?.summary || '').trim();
  } catch (_) {
    summaryText = '';
  }

  if (!summaryText) {
    summaryText = buildFallbackInsightText({
      totals,
      doneIssues,
      inProgressIssues,
      notStartedIssues,
    });
  }

  const dashboardHtml = buildHtmlDashboard({
    projectName: project.name,
    totals,
    doneIssues,
    summary: summaryText,
    recentCommitsCount: recentCommits.length,
  });

  return res.status(200).json({
    success: true,
    data: {
      markdown: summaryText,
      dashboardHtml,
      totals,
      doneIssues,
      inProgressIssues,
      notStartedIssues,
      sourceMeta: {
        mode: useJiraExecutionFirst ? 'jira_execution_first' : 'local_fallback',
        baselineDiscrepancy,
        jiraBacklogCount: jiraIssues.length,
        recentCommitCount: recentCommits.length,
      },
    },
  });
};

module.exports = {
  generateInsightsController,
  generateGlobalInsightsController,
  generateScrumMarkdownInsightsController,
};
