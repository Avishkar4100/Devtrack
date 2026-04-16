const Epic = require('../models/Epic');
const Story = require('../models/Story');
const Commit = require('../models/Commit');
const Project = require('../models/Project');

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const toIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildProjectStateSnapshot = async (projectId) => {
  const [project, epics, stories, commits] = await Promise.all([
    Project.findById(projectId).lean(),
    Epic.find({ project: projectId }).sort({ updatedAt: -1 }).limit(100).lean(),
    Story.find({ project: projectId }).sort({ updatedAt: -1 }).limit(300).lean(),
    Commit.find({ projectId }).sort({ date: -1 }).limit(120).lean(),
  ]);

  const backlogEpics = epics.map((epic) => ({
    id: asString(epic._id),
    title: asString(epic.title, 'Untitled Epic'),
    status: asString(epic.status, 'draft'),
    sprint: asString(epic.sprint, 'backlog'),
    priority: asString(epic.priority, 'medium'),
    jiraKey: epic.jiraEpicKey ? asString(epic.jiraEpicKey) : null,
  }));

  const backlogIssues = stories.map((story) => ({
    id: asString(story._id),
    title: asString(story.title, 'Untitled Story'),
    type: asString(story.type, 'story'),
    status: asString(story.status, 'draft'),
    codeStatus: asString(story.codeStatus, 'not_started'),
    sprint: asString(story.sprint, 'backlog'),
    priority: asString(story.priority, 'medium'),
    jiraKey: story.jiraIssueKey ? asString(story.jiraIssueKey) : null,
    epicId: story.epic ? asString(story.epic) : null,
    parentStoryId: story.parentStory ? asString(story.parentStory) : null,
  }));

  const worklog = commits.map((commit) => ({
    sha: asString(commit.sha),
    message: asString(commit.message),
    author: asString(commit.author),
    date: toIso(commit.date),
    filesChanged: Array.isArray(commit.filesChanged) ? commit.filesChanged : [],
  }));

  const comments = stories.flatMap((story) => {
    if (!Array.isArray(story.comments)) return [];
    return story.comments.map((comment) => ({
      issueId: asString(story._id),
      issueTitle: asString(story.title, 'Untitled Story'),
      issueKey: story.jiraIssueKey ? asString(story.jiraIssueKey) : null,
      text: asString(comment?.text),
      createdAt: toIso(comment?.createdAt),
      authorId: comment?.user ? asString(comment.user) : null,
    }));
  });

  const statuses = stories.map((story) => ({
    issueId: asString(story._id),
    issueKey: story.jiraIssueKey ? asString(story.jiraIssueKey) : null,
    title: asString(story.title, 'Untitled Story'),
    status: asString(story.status, 'draft'),
    codeStatus: asString(story.codeStatus, 'not_started'),
    updatedAt: toIso(story.updatedAt),
  }));

  const completedJiraIds = [...new Set(
    stories
      .filter((story) => String(story.status || '').toLowerCase() === 'done' || String(story.codeStatus || '').toLowerCase() === 'done')
      .map((story) => story.jiraIssueKey || story.jiraIssueId || story._id)
      .filter(Boolean)
      .map((value) => asString(value))
  )];

  return {
    project: {
      id: project?._id ? asString(project._id) : asString(projectId, ''),
      name: asString(project?.name, 'Untitled Project'),
      key: asString(project?.key, ''),
      status: asString(project?.status, 'active'),
      completionPercentage: Number(project?.completionPercentage || 0),
    },
    backlog: {
      epics: backlogEpics,
      issues: backlogIssues,
    },
    worklog,
    comments,
    statuses,
    completedJiraIds,
  };
};

module.exports = {
  buildProjectStateSnapshot,
};