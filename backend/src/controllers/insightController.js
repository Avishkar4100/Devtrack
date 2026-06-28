const Project = require('../models/Project');
const Commit = require('../models/Commit');
const User = require('../models/User');
const axios = require('axios');
const aiService = require('../services/aiService');
const logger = require('../config/logger');
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

const getRequestBaseUrl = (req) => {
  const protocol = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim() || 'http';
  const host = String(req?.get?.('host') || `127.0.0.1:${process.env.PORT || 5000}`).trim();
  return `${protocol}://${host}`;
};

const escapeHtml = (text = '') => String(text || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

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

const extractAcceptanceCriteriaFromText = (description = '') => {
  const text = String(description || '').trim();
  if (!text) return [];

  const match = text.match(/acceptance criteria\s*[:\-]\s*([\s\S]*)/i);
  if (!match) return [];

  return String(match[1] || '')
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
};

const extractJiraKeysFromText = (text = '') => {
  const keyRegex = /\b[A-Z][A-Z0-9]+-\d+\b/g;
  return String(text || '').match(keyRegex) || [];
};

const issueTypeFromName = (issueType = '') => {
  const normalized = String(issueType || '').toLowerCase();
  if (normalized.includes('epic')) return 'epic';
  if (normalized.includes('story')) return 'story';
  if (normalized.includes('task')) return 'task';
  if (normalized.includes('sub')) return 'subtask';
  if (normalized.includes('bug')) return 'task';
  return 'story';
};

const statusFromAi = (value = '', fallback = 'not_started') => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('done') || normalized.includes('complete') || normalized.includes('finished')) return 'done';
  if (normalized.includes('progress') || normalized.includes('partial') || normalized.includes('active') || normalized.includes('review')) return 'in_progress';
  if (normalized.includes('todo') || normalized.includes('not_started') || normalized.includes('not started') || normalized.includes('pending')) return 'not_started';
  return fallback;
};

const statusToProgress = (status = 'not_started', linkedCommitCount = 0, confidence = 0) => {
  const baseMap = {
    done: 100,
    in_progress: 65,
    partial: 50,
    not_started: 10,
  };
  const base = baseMap[String(status || '').toLowerCase()] ?? 20;
  const commitBoost = Math.min(20, Number(linkedCommitCount || 0) * 5);
  const confidenceBoost = Math.max(0, Math.min(15, Math.round(Number(confidence || 0) / 8)));
  return Math.max(0, Math.min(100, base + commitBoost + confidenceBoost));
};

const parseLooseJson = (text = '') => {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
};

const compactText = (text = '', max = 220) => {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > max ? `${raw.slice(0, max - 1)}...` : raw;
};

const summarizeCommitsForPrompt = (commits = []) => commits.slice(0, 8).map((commit) => ({
  sha: String(commit?.sha || '').slice(0, 10),
  author: String(commit?.author || 'Unknown').trim(),
  date: commit?.date || commit?.commit?.author?.date || commit?.commit?.committer?.date || null,
  message: compactText(commit?.message || commit?.commit?.message || '', 280),
}));

const buildIssueValidationPrompt = ({ projectName, issue, linkedCommits = [] }) => {
  const criteriaBlock = Array.isArray(issue.acceptanceCriteria) && issue.acceptanceCriteria.length
    ? issue.acceptanceCriteria.map((item) => `- ${item}`).join('\n')
    : '- No explicit acceptance criteria found';
  const commitBlock = linkedCommits.length
    ? linkedCommits.map((commit) => `- ${(commit.sha || '').slice(0, 10)} | ${commit.author || 'Unknown'} | ${commit.message || ''}`).join('\n')
    : '- No linked commit messages found';
  const subtaskBlock = Array.isArray(issue.childKeys) && issue.childKeys.length
    ? issue.childKeys.map((item) => `- ${item}`).join('\n')
    : '- No child issues found';

  return [
    'You are validating one Jira issue against matched GitHub commits.',
    'Use only the issue data and the matched commits below. Do not invent evidence.',
    'Return ONLY valid JSON with this exact shape:',
    '{"issueKey":"string","issueType":"epic|story|task|subtask","status":"done|in_progress|not_started|partial","progressPct":0-100,"owner":"string","whoDidWhat":"string","whatChanged":"string","summary":"string","confidence":0-100,"evidence":["string"],"warnings":["string"]}',
    'Rules:',
    '- whoDidWhat must identify the person or team responsible, based on assignee and commit authors when possible.',
    '- whatChanged must describe the change made by the matched commits, not generic progress language.',
    '- summary must be one short sentence that combines who did it and what changed, if the evidence supports that.',
    '- progressPct must reflect the evidence strength and completion state, not a guess.',
    '- evidence must list 1-3 short references to the matched commits or issue clues.',
    '- warnings should mention anything unverified, missing, or ambiguous.',
    `Project: ${projectName}`,
    `Issue Key: ${issue.key}`,
    `Issue Type: ${issue.type}`,
    `Title: ${issue.title}`,
    `Status: ${issue.status}`,
    `Owner: ${issue.assignee}`,
    `Parent: ${issue.parent || 'N/A'}`,
    `Child Issues:\n${subtaskBlock}`,
    `Priority: ${issue.priority}`,
    `Description: ${issue.description || 'N/A'}`,
    `Acceptance Criteria:\n${criteriaBlock}`,
    `Matched Commits:\n${commitBlock}`,
  ].join('\n');
};

const buildSummaryPrompt = ({ projectName, totals, issueChecks, sourceMeta, epicSummaries, teamSummaries }) => {
  const condensedIssues = issueChecks.slice(0, 40).map((issue) => ({
    issueKey: issue.issueKey,
    issueType: issue.issueType,
    status: issue.status,
    progressPct: issue.progressPct,
    owner: issue.owner,
    epic: issue.epic,
    title: issue.title,
    whoDidWhat: issue.whoDidWhat,
    whatChanged: issue.whatChanged,
    summary: issue.aiSummary || issue.summary,
    confidence: issue.confidence,
    linkedCommitCount: issue.linkedCommitCount,
  }));

  // Pre-compute person-wise rollup for prompt context
  const personRollup = {};
  issueChecks.forEach((issue) => {
    const owner = String(issue.owner || 'Unassigned').trim();
    if (!personRollup[owner]) {
      personRollup[owner] = { owner, total: 0, done: 0, inProgress: 0, notStarted: 0, issues: [] };
    }
    personRollup[owner].total += 1;
    if (issue.status === 'done') personRollup[owner].done += 1;
    else if (issue.status === 'in_progress') personRollup[owner].inProgress += 1;
    else personRollup[owner].notStarted += 1;
    personRollup[owner].issues.push(issue.issueKey);
  });

  return [
    'You are producing a release-manager delivery summary from structured issue checks.',
    'Base your answer only on the structured issue checks and rollups below.',
    'Return ONLY valid JSON (no markdown, no explanation) with this exact shape:',
    JSON.stringify({
      headline: "project delivery snapshot",
      deliveryHealth: "amber",
      overall: {
        summary: "concise business-readable overview of delivery status",
        doneSummary: "what has been completed and by whom",
        remainingSummary: "what work remains, who owns it, and priority",
        topRisk: "single biggest delivery risk with owner",
        nextAction: "next practical step for the team",
        confidence: 55
      },
      epicSummaries: [{
        epic: "epic name",
        summary: "what was done and what remains in this epic",
        progressPct: 85,
        doneCount: 4,
        inProgressCount: 1,
        notStartedCount: 0,
        owners: ["person1", "person2"],
        confidence: 55
      }],
      teamSummaries: [{
        owner: "person name",
        summary: "detailed analysis: what this person delivered with specific issue references, their velocity pattern, any blockers they face, and their impact on overall progress",
        currentFocus: "the most important active issue they are working on with context about what stage it is in",
        nextAction: "the single most impactful next step this person should take — be specific about which issue and why",
        doneCount: 3,
        inProgressCount: 1,
        notStartedCount: 0,
        blockedCount: 0,
        progressPct: 85,
        confidence: 55,
        strengths: "what this person consistently delivers well (e.g., 'consistently completes frontend tasks with full test coverage')",
        risk: "any risk specific to this person (e.g., 'has 5 high-priority items with no commit evidence yet')"
      }],
      issueHighlights: [{
        issueKey: "KEY-123",
        owner: "person name",
        summary: "one sentence combining who did what and what changed",
        whoDidWhat: "person or team responsible",
        whatChanged: "specific change made",
        status: "done",
        progressPct: 100,
        confidence: 55
      }]
    }, null, 2),
    '',
    'CRITICAL RULES (follow exactly):',
    '1. overall.summary: write 1-2 sentences summarizing the delivery — mention total issues, completion %, who delivered the most, and overall health.',
    '2. overall.doneSummary: list completed areas and who delivered them. Be specific about what was built.',
    '3. overall.remainingSummary: list what is still in progress or not started, with owner names and priority.',
    '4. overall.topRisk: identify the single riskiest remaining issue or person bottleneck.',
    '5. overall.nextAction: give one actionable step (e.g., "Unblock HOS-18 assigned to borhadetejas328").',
    '6. overall.confidence: score 0-100 based on evidence strength (commits, tests, traceability).',
    '7. epicSummaries: group issues by epic. For each epic, write a summary sentence about what was delivered and what is pending. List all owners involved.',
    '8. teamSummaries: create ONE entry per unique owner/person. For EACH person, provide DEEP analysis:\n' +
    '   - summary: what specific issues they delivered, their work pattern (frontend/backend/fullstack bias), velocity trend\n' +
    '   - currentFocus: the ONE most critical active issue, what stage it is at, and any blockers\n' +
    '   - nextAction: the exact next issue they should pick up and why (consider priority and dependencies)\n' +
    '   - strengths: what this person excels at based on their completed work patterns\n' +
    '   - risk: any delivery risk specific to this person (large backlog, no commits, blocked issues)\n' +
    '   - Use actual issue keys and real data. Be constructive and actionable.',
    '9. issueHighlights: pick the 8-12 most significant issues. Write a concise per-issue summary.',
    '10. Use the actual owner names from the data — do not invent or change names.',
    '',
    `Project: ${projectName}`,
    `Totals: ${JSON.stringify(totals)}`,
    `SourceMeta: ${JSON.stringify(sourceMeta)}`,
    `PersonRollup: ${JSON.stringify(Object.values(personRollup))}`,
    `EpicRollups: ${JSON.stringify(epicSummaries)}`,
    `TeamRollups: ${JSON.stringify(teamSummaries)}`,
    `IssueChecks: ${JSON.stringify(condensedIssues)}`,
  ].join('\n');
};

const buildFallbackIssueCheck = ({ issue, linkedCommits = [] }) => {
  const commitCount = linkedCommits.length;
  const status = commitCount > 0 ? (String(issue.status || '').toLowerCase() === 'done' ? 'done' : 'in_progress') : 'not_started';
  const confidence = commitCount > 0 ? 55 : 25;
  const owner = issue.assignee || 'Unassigned';
  const commitAuthors = [...new Set(linkedCommits.map((commit) => String(commit?.author || 'Unknown').trim()).filter(Boolean))];
  const firstCommit = linkedCommits[0];
  const whoDidWhat = commitAuthors.length
    ? commitAuthors.join(', ')
    : owner;
  const whatChanged = commitCount > 0
    ? compactText(firstCommit?.message || 'Updated the Jira issue', 120)
    : 'No commit evidence matched this issue key';
  const summary = commitCount > 0
    ? `${whoDidWhat} changed ${issue.key}: ${whatChanged}.`
    : `${issue.key} has no linked commit evidence yet.`;

  return {
    issueKey: issue.key,
    title: issue.title,
    issueType: issue.type,
    epic: issue.epic || 'General',
    priority: issue.priority || 'medium',
    description: issue.description || '',
    acceptanceCriteria: Array.isArray(issue.acceptanceCriteria) ? issue.acceptanceCriteria : [],
    status,
    progressPct: statusToProgress(status, commitCount, confidence),
    owner,
    whoDidWhat,
    whatChanged,
    summary,
    confidence,
    evidence: commitCount
      ? linkedCommits.slice(0, 3).map((commit) => `${(commit.sha || '').slice(0, 10)} by ${commit.author || 'Unknown'}`)
      : ['No linked commits found'],
    warnings: commitCount ? [] : ['No commit evidence matched this issue key'],
  };
};

const normalizeIssueCheck = ({ issue, linkedCommits = [], aiResult = null }) => {
  const base = buildFallbackIssueCheck({ issue, linkedCommits });
  const parsed = aiResult && typeof aiResult === 'object' ? aiResult : {};
  const status = statusFromAi(parsed.status, base.status);
  const confidence = Number(parsed.confidence ?? base.confidence ?? 0) || base.confidence;
  const progressPct = Number(parsed.progressPct ?? statusToProgress(status, linkedCommits.length, confidence));
  const whoDidWhat = String(parsed.whoDidWhat || base.whoDidWhat || base.owner || 'Unassigned').trim() || 'Unassigned';
  const whatChanged = String(parsed.whatChanged || base.whatChanged || '').trim() || (base.evidence?.[0] || 'No commit evidence matched this issue key');

  return {
    issueKey: String(parsed.issueKey || issue.key || '').trim(),
    title: String(issue.title || '').trim(),
    issueType: String(parsed.issueType || issue.type || 'story').trim(),
    epic: String(issue.epic || 'General').trim(),
    priority: String(issue.priority || 'medium').trim(),
    description: String(issue.description || '').trim(),
    acceptanceCriteria: Array.isArray(issue.acceptanceCriteria) ? issue.acceptanceCriteria : [],
    parent: String(issue.parent || '').trim() || null,
    childCount: Number(issue.childCount || 0),
    childKeys: Array.isArray(issue.childKeys) ? issue.childKeys.slice(0, 8) : [],
    status,
    progressPct: Math.max(0, Math.min(100, Math.round(progressPct))),
    owner: String(parsed.owner || base.owner || 'Unassigned').trim() || 'Unassigned',
    whoDidWhat,
    whatChanged,
    summary: String(parsed.summary || base.summary || '').trim(),
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    evidence: Array.isArray(parsed.evidence) && parsed.evidence.length
      ? parsed.evidence.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
      : base.evidence,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
      : base.warnings,
    linkedCommitCount: linkedCommits.length,
    linkedCommits: linkedCommits.slice(0, 6).map((commit) => ({
      sha: String(commit?.sha || '').slice(0, 10),
      author: String(commit?.author || 'Unknown').trim(),
      date: commit?.date || null,
      message: compactText(commit?.message || commit?.commit?.message || '', 220),
    })),
  };
};

const runWithConcurrency = async (items = [], limit = 3, worker) => {
  const results = [];
  let cursor = 0;
  const slots = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(slots);
  return results;
};

const buildRollupSummaries = (issueChecks = []) => {
  const byEpic = new Map();
  const byOwner = new Map();

  issueChecks.forEach((issue) => {
    const epicKey = String(issue?.epic || 'General').trim() || 'General';
    const ownerKey = String(issue?.owner || 'Unassigned').trim() || 'Unassigned';

    if (!byEpic.has(epicKey)) {
      byEpic.set(epicKey, []);
    }
    if (!byOwner.has(ownerKey)) {
      byOwner.set(ownerKey, []);
    }

    byEpic.get(epicKey).push(issue);
    byOwner.get(ownerKey).push(issue);
  });

  const summariseBucket = (items = []) => {
    const total = items.length;
    const doneCount = items.filter((item) => item.status === 'done').length;
    const inProgressCount = items.filter((item) => item.status === 'in_progress').length;
    const notStartedCount = items.filter((item) => item.status === 'not_started').length;
    const partialCount = items.filter((item) => item.status === 'partial').length;
    const progressPct = total ? Math.round(items.reduce((sum, item) => sum + Number(item.progressPct || 0), 0) / total) : 0;
    return { total, doneCount, inProgressCount, notStartedCount, partialCount, progressPct };
  };

  const epicSummaries = [...byEpic.entries()]
    .map(([epic, items]) => {
      const counts = summariseBucket(items);
      return {
        epic,
        summary: `${counts.doneCount}/${counts.total} issues done, ${counts.inProgressCount} in progress, ${counts.notStartedCount} not started.`,
        progressPct: counts.progressPct,
        doneCount: counts.doneCount,
        inProgressCount: counts.inProgressCount,
        notStartedCount: counts.notStartedCount,
        partialCount: counts.partialCount,
        owners: [...new Set(items.map((item) => String(item.owner || 'Unassigned').trim()).filter(Boolean))].slice(0, 6),
        confidence: Math.round(items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / Math.max(1, items.length)),
        issueKeys: items.map((item) => item.issueKey).filter(Boolean).slice(0, 12),
        topIssues: items
          .slice()
          .sort((a, b) => Number(b.progressPct || 0) - Number(a.progressPct || 0))
          .slice(0, 3)
          .map((item) => ({
            issueKey: item.issueKey,
            owner: item.owner,
            summary: item.summary,
            progressPct: item.progressPct,
            status: item.status,
          })),
      };
    })
    .sort((a, b) => Number(b.progressPct || 0) - Number(a.progressPct || 0));

  const teamSummaries = [...byOwner.entries()]
    .map(([owner, items]) => {
      const counts = summariseBucket(items);
      const doneExamples = items.filter((item) => item.status === 'done').slice(0, 3).map((item) => item.issueKey).filter(Boolean);
      const activeExamples = items.filter((item) => item.status !== 'done').slice(0, 3).map((item) => item.issueKey).filter(Boolean);
      return {
        owner,
        summary: `${counts.doneCount}/${counts.total} issues done for ${owner}.`,
        currentFocus: activeExamples.length ? `Focus on ${activeExamples.join(', ')}` : 'No active issues remain.',
        nextAction: activeExamples.length
          ? `Continue progress on ${activeExamples[0]} and clear the next blocker.`
          : 'Review completed work and pull in the next issue.',
        doneCount: counts.doneCount,
        inProgressCount: counts.inProgressCount,
        notStartedCount: counts.notStartedCount,
        blockedCount: counts.partialCount,
        progressPct: counts.progressPct,
        confidence: Math.round(items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / Math.max(1, items.length)),
        strengths: '',
        risk: counts.notStartedCount > 5 ? `Has ${counts.notStartedCount} untracked backlog items with no commit evidence.` : '',
        issueKeys: items.map((item) => item.issueKey).filter(Boolean).slice(0, 12),
        topDoneIssues: doneExamples,
      };
    })
    .sort((a, b) => Number(b.progressPct || 0) - Number(a.progressPct || 0));

  const issueHighlights = issueChecks
    .slice()
    .sort((a, b) => Number(b.progressPct || 0) - Number(a.progressPct || 0))
    .slice(0, 12)
    .map((item) => ({
      issueKey: item.issueKey,
      owner: item.owner,
      whoDidWhat: item.whoDidWhat,
      whatChanged: item.whatChanged,
      summary: item.summary,
      status: item.status,
      progressPct: item.progressPct,
      confidence: item.confidence,
    }));

  return { epicSummaries, teamSummaries, issueHighlights };
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
  acceptanceCriteria: Array.isArray(story?.acceptanceCriteria) ? story.acceptanceCriteria : [],
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
  const localType = issueTypeFromName(issueType);
  const statusName = String(fields?.status?.name || '').toLowerCase();
  let status = 'to_do';
  if (statusName.includes('done') || statusName.includes('closed') || statusName.includes('resolved')) status = 'done';
  else if (statusName.includes('review') || statusName.includes('progress') || statusName.includes('develop')) status = 'in_progress';

  const priorityName = String(fields?.priority?.name || 'medium').toLowerCase();

  const subtasks = Array.isArray(fields?.subtasks) ? fields.subtasks : [];

  return {
    ...normalizeIssue({
    jiraIssueKey: issue.key || `JIRA-${index + 1}`,
    title: fields?.summary || issue.key || `Issue ${index + 1}`,
    description: parseJiraDescription(fields?.description),
    status,
    type: localType,
    priority: priorityName,
    assignee: fields?.assignee?.displayName || 'Unassigned',
    reporter: fields?.reporter?.displayName || 'Unknown',
    epic: fields?.parent?.key || fields?.parent?.fields?.summary || 'General',
    parent: fields?.parent?.key || fields?.parent?.fields?.summary || null,
    acceptanceCriteria: extractAcceptanceCriteriaFromText(parseJiraDescription(fields?.description)),
    commentsCount: Number(fields?.comment?.total || 0),
    updatedAt: fields?.updated || fields?.created || null,
  }, index, linkedCommits, 'jira'),
    childCount: subtasks.length,
    childKeys: subtasks.map((item) => String(item?.key || '').trim()).filter(Boolean).slice(0, 8),
  };
};

const fetchJiraIssueIndex = async ({ req, jiraProjectKey }) => {
  if (!jiraProjectKey) return [];

  const baseURL = getRequestBaseUrl(req);
  const authHeader = req?.headers?.authorization || '';

  const { data } = await axios.get(`${baseURL}/api/jira/server/issues`, {
    headers: authHeader ? { Authorization: authHeader } : {},
    params: {
      projectKey: jiraProjectKey,
      fetchAll: true,
      maxResults: 100,
      fields: 'summary,issuetype,status,parent,assignee,updated',
    },
    timeout: 30000,
  });

  return Array.isArray(data?.data?.issues) ? data.data.issues : [];
};

const fetchJiraIssueDetails = async ({ req, issueKeys = [] }) => {
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) return [];

  const baseURL = getRequestBaseUrl(req);
  const authHeader = req?.headers?.authorization || '';
  const fields = 'summary,description,priority,status,issuetype,parent,project,assignee,reporter,updated,created,comment,subtasks';

  return runWithConcurrency(issueKeys, 4, async (issueKey) => {
    try {
      const { data } = await axios.get(`${baseURL}/api/jira/server/issues/${encodeURIComponent(issueKey)}`, {
        headers: authHeader ? { Authorization: authHeader } : {},
        params: {
          fields,
          expand: 'names,renderedFields',
        },
        timeout: 30000,
      });

      return data?.data || null;
    } catch (error) {
      logger.warn(`Jira issue detail fetch failed for ${issueKey}: ${error?.message || 'Unknown error'}`);
      return null;
    }
  });
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

  // ── Enrich with delivery snapshot data if cached ──
  if (project.deliverySnapshot) {
    const snap = project.deliverySnapshot;
    const snapTotals = snap.totals || {};

    // Merge snapshot totals into overall metrics
    if (snapTotals.total > 0) {
      const enrichedOverall = [
        { label: 'Total Issues', value: String(snapTotals.total || 0), note: `${snapTotals.done || 0} done, ${snapTotals.notStarted || 0} not started` },
        { label: 'Progress', value: `${snapTotals.completionPct || 0}%`, note: `Full Jira backlog coverage` },
        { label: 'AI-Verified', value: String(snapTotals.matchedCount || snap.sourceMeta?.matchedIssueCount || 0), note: 'Issues with commit evidence' },
        { label: 'Commit Trace', value: `${snapTotals.commitCoveragePct || 0}%`, note: 'Done issues with linked commits' },
      ];
      data.overall = enrichedOverall;
    }

    // Merge team summaries from snapshot
    if (Array.isArray(snap.teamSummaries) && snap.teamSummaries.length) {
      data.teamInsights = snap.teamSummaries.map((t) => {
        const doneCount = t.doneCount || 0;
        const inProgressCount = t.inProgressCount || 0;
        const notStartedCount = t.notStartedCount || 0;
        const totalAssigned = doneCount + inProgressCount + notStartedCount;
        // Dynamic score based on completion ratio + activity
        const completionRatio = totalAssigned > 0 ? Math.round((doneCount / totalAssigned) * 100) : 0;
        const activityBonus = inProgressCount > 0 ? 15 : 0;
        const score = Math.min(99, Math.max(5, completionRatio + activityBonus + (doneCount >= 5 ? 10 : 0)));
        // Role based on actual output
        const role = doneCount >= 5 ? 'Lead' : doneCount >= 2 ? 'Core' : inProgressCount > 0 ? 'Active' : 'Contributor';
        // Bullet-point style concise notes
        const bullets = [];
        if (doneCount > 0) bullets.push(`✅ ${doneCount} done`);
        if (inProgressCount > 0) bullets.push(`🔄 ${inProgressCount} in progress`);
        if (notStartedCount > 0) bullets.push(`⏳ ${notStartedCount} not started`);
        if (t.currentFocus) bullets.push(`🎯 Focus: ${t.currentFocus}`);
        if (t.risk) bullets.push(`⚠️ ${t.risk}`);
        if (t.strengths) bullets.push(`💪 ${t.strengths}`);
        const note = bullets.length ? bullets.join(' | ') : (t.summary || 'No activity tracked');
        return {
          name: t.owner || 'Unassigned',
          role,
          score,
          doneCount,
          inProgressCount,
          notStartedCount,
          currentFocus: t.currentFocus || '',
          nextAction: t.nextAction || '',
          strengths: t.strengths || '',
          risk: t.risk || '',
          issueKeys: t.issueKeys || [],
          topDoneIssues: t.topDoneIssues || [],
          note,
        };
      });
    }

    // Merge epic summaries into module-wise with Jira epic titles
    if (Array.isArray(snap.epicSummaries) && snap.epicSummaries.length) {
      data.moduleWise = snap.epicSummaries
        .filter((e) => {
          // Filter out 'General' only when it has no real epic title and minimal activity
          const epicName = (e.title || e.epic || '').trim();
          if (epicName === 'General' || epicName === 'Uncategorized') {
            return (e.doneCount || 0) > 0 || (e.inProgressCount || 0) > 0;
          }
          return true;
        })
        .map((e) => {
          const epicName = e.title || e.epic || 'General';
          const isRealEpic = e.title && e.title !== e.epic;
          return {
            module: epicName,
            epicKey: isRealEpic ? e.epic : (e.epic !== 'General' ? e.epic : null),
            summary: e.summary || '',
            progress: e.progressPct || 0,
            velocity: e.doneCount || 0,
            total: (e.doneCount || 0) + (e.inProgressCount || 0) + (e.notStartedCount || 0),
            done: e.doneCount || 0,
            inProgress: e.inProgressCount || 0,
            notStarted: e.notStartedCount || 0,
            defectLeakage: (e.notStartedCount || 0) > 5 ? 'high' : (e.notStartedCount || 0) > 2 ? 'medium' : 'low',
            risk: (e.progressPct || 0) < 30 ? 'high' : (e.progressPct || 0) < 65 ? 'medium' : 'low',
            aiCoverage: (e.confidence || 0) > 60 ? 'high' : (e.confidence || 0) > 30 ? 'medium' : 'low',
            owners: e.owners || [],
          };
        });
    }

    // Merge issue highlights from snapshot
    if (Array.isArray(snap.issueHighlights) && snap.issueHighlights.length) {
      data.issueWise = snap.issueHighlights.slice(0, 8).map((i) => ({
        id: i.issueKey,
        title: i.summary || i.issueKey,
        owner: i.owner || 'Unassigned',
        status: i.status || 'unknown',
        severity: i.status === 'not_started' ? 'high' : i.status === 'in_progress' ? 'medium' : 'low',
        eta: i.status === 'done' ? 'Done' : 'Pending',
      }));
    }

    // Update risks from snapshot
    if (snapTotals.notStarted > 0) {
      data.risks = [
        ...(data.risks || []),
        `${snapTotals.notStarted} issues not started — largest delivery gap`,
        snap.overallSummary?.topRisk || '',
      ].filter(Boolean).slice(0, 5);
    }

    // Update daily summary from snapshot context
    if (snap.overallSummary) {
      data.dailySummary = [
        `${snapTotals.completionPct || 0}% overall completion`,
        `${snapTotals.done || 0} done / ${snapTotals.total || 0} total issues`,
        snap.overallSummary.nextAction || 'Review pending items',
      ].filter(Boolean).slice(0, 5);
    }

    // Enrich executive summary
    data.executiveSummary = {
      automationCoverage: `${snapTotals.matchRatePct || 0}%`,
      validationTrust: `${snapTotals.commitCoveragePct || 0}%`,
      syncReliability: `${Math.max(80, 100 - (snapTotals.unmatchedCount || 0))}%`,
      standupOverhead: `${(0.5 + (snapTotals.total || 0) * 0.02).toFixed(1)}h/week`,
    };
  }

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

  // ── Return cached snapshot if exists and not a force-refresh ──
  const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
  if (!forceRefresh && project.deliverySnapshot) {
    logger.info('Delivery snapshot served from cache for project %s', projectId);
    return res.status(200).json({
      success: true,
      data: {
        ...project.deliverySnapshot,
        cached: true,
        cachedAt: project.deliverySnapshotAt,
      },
    });
  }

  const commits = await Commit.find({ projectId }).sort({ date: -1 }).limit(300).lean();

  let jiraIssues = [];
  try {
    jiraIssues = await fetchJiraIssueIndex({ req, jiraProjectKey: project.jiraProjectKey });
  } catch (error) {
    logger.error(`Jira issue index fetch failed for project ${projectId}: ${error?.message || 'Unknown error'}`);
    return res.status(502).json({
      success: false,
      message: 'Unable to load Jira issues for the delivery snapshot. Check Jira connectivity and retry.',
    });
  }

  if (!jiraIssues.length) {
    return res.status(404).json({
      success: false,
      message: 'No Jira issues were found for this project. Delivery snapshot requires Jira issues.',
    });
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

  const indexedIssues = jiraIssues.map((item, index) => ({
    key: String(item?.key || `JIRA-${index + 1}`).trim(),
    title: String(item?.fields?.summary || item?.key || `Issue ${index + 1}`).trim(),
    issueType: issueTypeFromName(item?.fields?.issuetype?.name || 'story'),
    status: statusFromAi(item?.fields?.status?.name || '', 'not_started'),
    assignee: item?.fields?.assignee?.displayName || 'Unassigned',
    parent: item?.fields?.parent?.key || item?.fields?.parent?.fields?.summary || null,
    updatedAt: item?.fields?.updated || item?.fields?.created || null,
  }));

  // ── Build epic key → title map from raw Jira issue data ──
  const epicTitleMap = new Map();
  const allTypes = new Set();
  jiraIssues.forEach((item) => {
    const rawType = String(item?.fields?.issuetype?.name || '').toLowerCase();
    allTypes.add(rawType);
    const key = String(item?.key || '').trim();
    const title = String(item?.fields?.summary || item?.key || '').trim();
    if (rawType.includes('epic') && key && title) {
      epicTitleMap.set(key, title);
    }
  });
  logger.info('Epic title map: %d epics found (keys: %s). All Jira types seen: %s',
    epicTitleMap.size,
    [...epicTitleMap.keys()].slice(0, 8).join(', '),
    [...allTypes].join(', ')
  );

  const matchedIssueIndex = indexedIssues.filter((item) => (commitsByIssueKey.get(item.key) || []).length > 0);
  const detailedIssues = await fetchJiraIssueDetails({
    req,
    issueKeys: matchedIssueIndex.map((item) => item.key),
  });

  const detailByKey = new Map(
    detailedIssues
      .filter(Boolean)
      .map((issue) => [String(issue?.key || '').trim(), issue])
      .filter(([key]) => Boolean(key))
  );

  const issueSeed = matchedIssueIndex.map((item, index) => {
    const linkedCommits = commitsByIssueKey.get(item.key) || [];
    const detail = detailByKey.get(item.key);
    if (detail) {
      return jiraIssueToNormalized(detail, linkedCommits, index);
    }

    return normalizeIssue({
      jiraIssueKey: item.key,
      title: item.title,
      description: '',
      status: item.status,
      type: item.issueType,
      assignee: item.assignee,
      reporter: 'Unknown',
      epic: item.parent || 'General',
      parent: item.parent,
      acceptanceCriteria: [],
      commentsCount: 0,
      updatedAt: item.updatedAt,
    }, index, linkedCommits, 'jira');
  });

  const issueChecks = await runWithConcurrency(issueSeed, 2, async (issue) => {
    const linkedCommits = commitsByIssueKey.get(issue.key) || [];
    const prompt = buildIssueValidationPrompt({
      projectName: project.name,
      issue,
      linkedCommits: summarizeCommitsForPrompt(linkedCommits),
    });

    try {
      const aiResult = await aiService.testLLM({ prompt });
      const parsed = parseLooseJson(aiResult?.summary || aiResult?.output || aiResult?.text || '');
      const normalized = normalizeIssueCheck({ issue, linkedCommits, aiResult: parsed });
      normalized.aiRaw = String(aiResult?.summary || '').trim();
      normalized.aiSummary = normalized.summary;
      return normalized;
    } catch (error) {
      logger.warn(`Issue validation AI call failed for ${issue.key}: ${error?.message || 'Unknown error'}`);
      const fallback = normalizeIssueCheck({ issue, linkedCommits, aiResult: null });
      fallback.aiSummary = fallback.summary;
      return fallback;
    }
  });

  const { epicSummaries, teamSummaries, issueHighlights } = buildRollupSummaries(issueChecks);

  // ── Build unmatched issue entries (no AI call, Jira-status-based fallback) ──
  const matchedKeys = new Set(issueChecks.map((c) => c.issueKey));
  const unmatchedIssues = indexedIssues
    .filter((item) => !matchedKeys.has(item.key))
    .map((item) => {
      const linkedCommits = commitsByIssueKey.get(item.key) || [];
      return normalizeIssueCheck({
        issue: {
          key: item.key,
          title: item.title,
          description: '',
          type: item.issueType,
          status: item.status,
          priority: 'medium',
          assignee: item.assignee,
          epic: item.parent || 'General',
          parent: item.parent,
          acceptanceCriteria: [],
          commentsCount: 0,
          childCount: 0,
          childKeys: [],
        },
        linkedCommits,
        aiResult: null,
      });
    });

  const allIssueChecks = [...issueChecks, ...unmatchedIssues];

  const doneIssues = allIssueChecks.filter((item) => item.status === 'done');
  const inProgressIssues = allIssueChecks.filter((item) => item.status === 'in_progress');
  const notStartedIssues = allIssueChecks.filter((item) => item.status === 'not_started');
  const partialIssues = allIssueChecks.filter((item) => item.status === 'partial');

  const total = allIssueChecks.length;
  const done = doneIssues.length;
  const inProgress = inProgressIssues.length;
  const notStarted = notStartedIssues.length;
  const partial = partialIssues.length;
  const completionPct = total ? Math.round((done / total) * 100) : 0;
  const matchRatePct = total ? Math.round((issueChecks.length / total) * 100) : 0;
  const commentCoveragePct = total
    ? Math.round((allIssueChecks.filter((item) => (item.linkedCommitCount || 0) > 0).length / total) * 100)
    : 0;
  const doneWithTrace = doneIssues.filter((item) => item.linkedCommitCount > 0).length;
  const commitCoveragePct = done ? Math.round((doneWithTrace / done) * 100) : 0;

  // ── Full-backlog rollups (matched + unmatched) ──
  const { epicSummaries: fullEpicSummaries, teamSummaries: fullTeamSummaries } = buildRollupSummaries(allIssueChecks);

  // Enrich epic summaries with actual Jira epic titles
  const enrichedEpicSummaries = fullEpicSummaries.map((es) => ({
    ...es,
    title: epicTitleMap.get(es.epic) || es.summary || es.epic,
  }));
  logger.info('Enriched epic summaries: %d entries, first title=%s', enrichedEpicSummaries.length, enrichedEpicSummaries[0]?.title || 'none');

  const totals = {
    total,
    done,
    inProgress,
    notStarted,
    partial,
    completionPct,
    commentCoveragePct,
    matchRatePct,
    commitCoveragePct,
    matchedCount: issueChecks.length,
    unmatchedCount: unmatchedIssues.length,
  };

  const sourceMeta = {
    mode: 'jira_full_backlog',
    jiraBacklogCount: jiraIssues.length,
    indexedIssueCount: indexedIssues.length,
    matchedIssueCount: matchedIssueIndex.length,
    hydratedIssueCount: detailedIssues.filter(Boolean).length,
    recentCommitCount: commits.length,
    matchedCommitIssueCount: issueChecks.filter((item) => item.linkedCommitCount > 0).length,
    unmatchedIssueCount: unmatchedIssues.length,
  };

  const summaryPrompt = buildSummaryPrompt({
    projectName: project.name,
    totals,
    issueChecks: allIssueChecks,
    sourceMeta,
    epicSummaries: enrichedEpicSummaries,
    teamSummaries: fullTeamSummaries,
  });

  let summaryPayload = null;
  try {
    const aiResult = await aiService.testLLM({ prompt: summaryPrompt });
    summaryPayload = parseLooseJson(aiResult?.summary || aiResult?.output || aiResult?.text || '');
  } catch (error) {
    logger.warn('Delivery summary AI call failed for project %s: %s', projectId, error?.message || 'Unknown error');
  }

  if (!summaryPayload || typeof summaryPayload !== 'object') {
    summaryPayload = {
      headline: `${project.name} delivery snapshot`,
      deliveryHealth: completionPct >= 80 ? 'green' : completionPct >= 50 ? 'amber' : 'red',
      overall: {
        summary: allIssueChecks.length
          ? buildFallbackInsightText({
              totals,
              doneIssues,
              inProgressIssues,
              notStartedIssues,
            })
          : 'No Jira issues found for this project.',
        doneSummary: doneIssues.length
          ? `${doneIssues.length} of ${total} issues are complete (${completionPct}%). ${doneWithTrace} done issues are commit-traced.`
          : 'No issues are complete yet.',
        remainingSummary: allIssueChecks.length
          ? `${inProgress + notStarted + partial} issues still need attention — ${notStarted} not started, ${inProgress} in progress.`
          : 'No issues found.',
        topRisk: notStarted > done + inProgress
          ? `${notStarted} issues (${Math.round((notStarted / total) * 100)}%) are not started — biggest delivery gap.`
          : inProgressIssues[0]
            ? `${inProgressIssues[0].issueKey} is in progress and should be checked next.`
            : notStartedIssues[0]
              ? `${notStartedIssues[0].issueKey} has not started yet.`
              : 'No major delivery risk detected.',
        nextAction: notStartedIssues.length
          ? `Prioritize the top ${Math.min(3, notStartedIssues.length)} not-started issues: ${notStartedIssues.slice(0, 3).map((i) => i.issueKey).join(', ')}.`
          : 'Review the issue group with the lowest progress and verify the most recent commit evidence.',
        confidence: 55,
      },
      epicSummaries: enrichedEpicSummaries,
      teamSummaries: fullTeamSummaries,
      issueHighlights,
    };
  }

  const overallSummary = {
    headline: String(summaryPayload.headline || `${project.name} delivery snapshot`).trim(),
    deliveryHealth: String(summaryPayload.deliveryHealth || 'amber').trim(),
    summary: String(summaryPayload.overall?.summary || summaryPayload.summary || '').trim(),
    doneSummary: String(summaryPayload.overall?.doneSummary || '').trim(),
    remainingSummary: String(summaryPayload.overall?.remainingSummary || '').trim(),
    topRisk: String(summaryPayload.overall?.topRisk || summaryPayload.topRisk || '').trim(),
    nextAction: String(summaryPayload.overall?.nextAction || summaryPayload.nextAction || '').trim(),
    confidence: Math.max(0, Math.min(100, Number(summaryPayload.overall?.confidence || summaryPayload.confidence || 55))),
  };

  const normalizedEpicSummaries = Array.isArray(summaryPayload.epicSummaries) && summaryPayload.epicSummaries.length
    ? summaryPayload.epicSummaries.map((item) => ({
        epic: String(item?.epic || 'General').trim(),
        title: epicTitleMap.get(String(item?.epic || '').trim()) || null,
        summary: String(item?.summary || '').trim(),
        progressPct: Math.max(0, Math.min(100, Number(item?.progressPct || 0))),
        doneCount: Number(item?.doneCount || 0),
        inProgressCount: Number(item?.inProgressCount || 0),
        notStartedCount: Number(item?.notStartedCount || 0),
        partialCount: Number(item?.partialCount || 0),
        owners: Array.isArray(item?.owners) ? item.owners.map((owner) => String(owner).trim()).filter(Boolean).slice(0, 8) : [],
        confidence: Math.max(0, Math.min(100, Number(item?.confidence || 0))),
        issueKeys: Array.isArray(item?.issueKeys) ? item.issueKeys.map((key) => String(key).trim()).filter(Boolean).slice(0, 12) : [],
        topIssues: Array.isArray(item?.topIssues)
          ? item.topIssues.map((issue) => ({
              issueKey: String(issue?.issueKey || '').trim(),
              owner: String(issue?.owner || '').trim(),
              summary: String(issue?.summary || '').trim(),
              progressPct: Math.max(0, Math.min(100, Number(issue?.progressPct || 0))),
              status: String(issue?.status || '').trim(),
            }))
          : [],
      }))
    : enrichedEpicSummaries;

  const normalizedTeamSummaries = Array.isArray(summaryPayload.teamSummaries) && summaryPayload.teamSummaries.length
    ? summaryPayload.teamSummaries.map((item) => ({
        owner: String(item?.owner || 'Unassigned').trim() || 'Unassigned',
        summary: String(item?.summary || '').trim(),
        currentFocus: String(item?.currentFocus || '').trim(),
        nextAction: String(item?.nextAction || '').trim(),
        doneCount: Number(item?.doneCount || 0),
        inProgressCount: Number(item?.inProgressCount || 0),
        notStartedCount: Number(item?.notStartedCount || 0),
        blockedCount: Number(item?.blockedCount || 0),
        progressPct: Math.max(0, Math.min(100, Number(item?.progressPct || 0))),
        confidence: Math.max(0, Math.min(100, Number(item?.confidence || 0))),
        strengths: String(item?.strengths || '').trim(),
        risk: String(item?.risk || '').trim(),
        issueKeys: Array.isArray(item?.issueKeys) ? item.issueKeys.map((key) => String(key).trim()).filter(Boolean).slice(0, 12) : [],
        topDoneIssues: Array.isArray(item?.topDoneIssues) ? item.topDoneIssues.map((key) => String(key).trim()).filter(Boolean).slice(0, 8) : [],
      }))
    : fullTeamSummaries;

  const normalizedIssueHighlights = Array.isArray(summaryPayload.issueHighlights) && summaryPayload.issueHighlights.length
    ? summaryPayload.issueHighlights.map((item) => ({
        issueKey: String(item?.issueKey || '').trim(),
        owner: String(item?.owner || 'Unassigned').trim() || 'Unassigned',
        whoDidWhat: String(item?.whoDidWhat || '').trim(),
        whatChanged: String(item?.whatChanged || '').trim(),
        summary: String(item?.summary || '').trim(),
        status: String(item?.status || '').trim(),
        progressPct: Math.max(0, Math.min(100, Number(item?.progressPct || 0))),
        confidence: Math.max(0, Math.min(100, Number(item?.confidence || 0))),
      }))
    : issueHighlights;

  const logs = [
    {
      level: 'info',
      label: 'Snapshot mode',
      message: `${sourceMeta.mode} with ${sourceMeta.jiraBacklogCount} Jira issues and ${sourceMeta.recentCommitCount} commits`,
      meta: sourceMeta,
    },
    {
      level: 'info',
      label: 'Issue matching',
      message: `indexed=${sourceMeta.indexedIssueCount}, matched=${sourceMeta.matchedIssueCount}, hydrated=${sourceMeta.hydratedIssueCount}`,
      meta: {
        indexedIssueCount: sourceMeta.indexedIssueCount,
        matchedIssueCount: sourceMeta.matchedIssueCount,
        hydratedIssueCount: sourceMeta.hydratedIssueCount,
      },
    },
    {
      level: 'info',
      label: 'Issue counts (full backlog)',
      message: `done=${done}, inProgress=${inProgress}, notStarted=${notStarted}, partial=${partial}`,
      meta: totals,
    },
    {
      level: 'info',
      label: 'Coverage',
      message: `completion=${completionPct}%, commitTrace=${commitCoveragePct}%, matchRate=${matchRatePct}%`,
      meta: {
        completionPct,
        commitCoveragePct,
        commentCoveragePct,
        matchRatePct,
      },
    },
  ];

  logger.info(
    'Delivery snapshot generated for project %s: mode=%s total=%s done=%s inProgress=%s notStarted=%s partial=%s commits=%s matched=%s hydrated=%s',
    projectId,
    sourceMeta.mode,
    total,
    done,
    inProgress,
    notStarted,
    partial,
    sourceMeta.recentCommitCount,
    sourceMeta.matchedIssueCount,
    sourceMeta.hydratedIssueCount
  );

  const issueGroups = {
    epic: allIssueChecks.filter((item) => item.issueType === 'epic'),
    story: allIssueChecks.filter((item) => item.issueType === 'story'),
    task: allIssueChecks.filter((item) => item.issueType === 'task'),
    subtask: allIssueChecks.filter((item) => item.issueType === 'subtask'),
  };

  // Also preserve just the AI-validated matched checks for the logs display
  const matchedLogs = issueChecks.slice(0, 8).map((item) => ({
    level: item.status === 'done' ? 'success' : item.status === 'in_progress' ? 'warning' : 'default',
    label: item.issueKey,
    message: item.aiSummary || item.summary,
    meta: {
      type: item.issueType,
      status: item.status,
      progressPct: item.progressPct,
      confidence: item.confidence,
      linkedCommitCount: item.linkedCommitCount,
    },
  }));

  const unmatchedLogs = unmatchedIssues.length > 0 ? [{
    level: 'info',
    label: 'Unmatched backlog',
    message: `${unmatchedIssues.length} Jira issues have no matching commits — included for full-project visibility.`,
    meta: {
      unmatchedCount: unmatchedIssues.length,
      sampleKeys: unmatchedIssues.slice(0, 5).map((i) => i.issueKey),
    },
  }] : [];

  // ── Persist snapshot to project (fire-and-forget, don't block response) ──
  const snapshotPayload = {
    markdown: overallSummary.summary,
    summary: overallSummary,
    summaryText: overallSummary.summary,
    overallSummary,
    totals,
    issueChecks: allIssueChecks,
    matchedIssueChecks: issueChecks,
    unmatchedIssueChecks: unmatchedIssues,
    issueGroups,
    epicSummaries: normalizedEpicSummaries,
    teamSummaries: normalizedTeamSummaries,
    issueHighlights: normalizedIssueHighlights,
    doneIssues,
    inProgressIssues,
    notStartedIssues,
    partialIssues,
    logs: [...logs, ...matchedLogs, ...unmatchedLogs],
    sourceMeta,
    jiraBacklogCount: jiraIssues.length,
    recentCommitCount: commits.length,
    projectName: project.name,
  };

  Project.findByIdAndUpdate(projectId, {
    deliverySnapshot: snapshotPayload,
    deliverySnapshotAt: new Date(),
  }).catch((err) => logger.warn('Failed to persist delivery snapshot for project %s: %s', projectId, err.message));

  return res.status(200).json({
    success: true,
    data: snapshotPayload,
  });
};

module.exports = {
  generateInsightsController,
  generateGlobalInsightsController,
  generateScrumMarkdownInsightsController,
};

