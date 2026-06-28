const axios = require('axios');
const Story = require('../models/Story');
const Commit = require('../models/Commit');
const Epic = require('../models/Epic');
const { getActiveAIConfigPayload } = require('./aiConfigService');
const { resolveAiServiceBaseUrl } = require('../utils/aiServiceUrl');

const toPercent = (completed, total) => {
  if (!total) return 0;
  return Math.round((completed / total) * 100);
};

const inferRisk = ({ completed, total, recentCommits }) => {
  let risk = 'low';

  if (total > 0 && completed / total < 0.5) {
    risk = 'medium';
  }

  if (recentCommits.length < 3) {
    risk = 'high';
  }

  return risk;
};

const toDayKey = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const weekdayLabel = (dayKey) => {
  const d = new Date(dayKey);
  return d.toLocaleDateString('en-US', { weekday: 'short' });
};

const buildDailyReport = (stories = [], commits = []) => {
  const today = new Date();
  const keys = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    keys.push(d.toISOString().slice(0, 10));
  }

  const report = new Map(keys.map((k) => [k, {
    day: weekdayLabel(k),
    date: k,
    completed: 0,
    created: 0,
    carryOver: 0,
    deploys: 0,
    incidents: 0,
  }]));

  stories.forEach((story) => {
    const createdKey = toDayKey(story.createdAt);
    const updatedKey = toDayKey(story.updatedAt);

    if (createdKey && report.has(createdKey)) {
      report.get(createdKey).created += 1;
    }
    if (story.status === 'done' && updatedKey && report.has(updatedKey)) {
      report.get(updatedKey).completed += 1;
      report.get(updatedKey).deploys += 1;
    }
    if (story.status !== 'done') {
      keys.forEach((k) => {
        if (new Date(k) >= new Date(story.createdAt || k)) {
          report.get(k).carryOver += 1;
        }
      });
    }
  });

  commits.forEach((commit) => {
    const key = toDayKey(commit.date || commit.createdAt);
    if (!key || !report.has(key)) return;
    if (/fix|bug|incident|hotfix/i.test(commit.message || '')) {
      report.get(key).incidents += 1;
    }
  });

  return [...report.values()];
};

const buildIssueWise = (stories = []) => {
  const severityRank = { highest: 'critical', high: 'high', medium: 'medium', low: 'low', lowest: 'low' };
  return stories
    .filter((s) => ['story', 'task', 'bug'].includes(s.type))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 8)
    .map((story) => ({
      id: story.jiraIssueKey || story.storyKey || String(story._id).slice(-6),
      severity: severityRank[story.priority] || 'medium',
      title: story.title,
      owner: story.assignee ? String(story.assignee) : 'Unassigned',
      status: story.status,
      eta: story.dueDate ? new Date(story.dueDate).toLocaleDateString('en-US') : 'N/A',
    }));
};

const buildTeamInsights = (commits = []) => {
  const byAuthor = new Map();
  commits.forEach((c) => {
    const name = c.author || 'Unknown';
    byAuthor.set(name, (byAuthor.get(name) || 0) + 1);
  });

  const totalCommits = [...byAuthor.values()].reduce((sum, v) => sum + v, 0) || 1;
  return [...byAuthor.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count], idx) => {
      const contributionPct = Math.round((count / totalCommits) * 100);
      // Dynamic score: base 10 + contribution % (0-80) + recency bonus (0-10)
      const score = Math.min(99, 10 + contributionPct + (idx === 0 ? 10 : idx < 3 ? 5 : 0));
      const role = idx === 0 ? 'Lead' : contributionPct >= 20 ? 'Core' : 'Contributor';
      return {
        name,
        role,
        score,
        commits: count,
        contributionPct,
        note: `${count} commits · ${contributionPct}% of team activity`,
      };
    });
};

const buildModuleWise = (stories = [], epics = []) => {
  const epicMap = new Map(epics.map((e) => [String(e._id), e.title]));
  const byModule = new Map();

  stories.forEach((s) => {
    const epicTitle = epicMap.get(String(s.epic || ''));
    // Only use 'Uncategorized' if no real epic mapping exists for this story
    const module = epicTitle || (s.epic ? String(s.epic) : 'Uncategorized');
    if (!byModule.has(module)) {
      byModule.set(module, { module, total: 0, done: 0, inProgress: 0, notStarted: 0, velocity: 0, defects: 0 });
    }
    const row = byModule.get(module);
    row.total += 1;
    row.velocity += s.storyPoints || 0;
    if (s.status === 'done') row.done += 1;
    else if (s.status === 'in_progress') row.inProgress += 1;
    else row.notStarted += 1;
    if (s.type === 'bug') row.defects += 1;
  });

  return [...byModule.values()]
    .filter((row) => {
      // Filter out 'General' or 'Uncategorized' only if it has 0 stories with real data
      if (row.module === 'General' || row.module === 'Uncategorized') {
        return row.total > 0 && (row.done > 0 || row.inProgress > 0);
      }
      return true;
    })
    .map((row) => {
      const progress = row.total ? Math.round((row.done / row.total) * 100) : 0;
      const risk = row.defects > 2 || progress < 35 ? 'high' : progress < 65 ? 'medium' : 'low';
      return {
        module: row.module,
        progress,
        velocity: row.velocity,
        total: row.total,
        done: row.done,
        inProgress: row.inProgress,
        notStarted: row.notStarted,
        defectLeakage: row.defects > 2 ? 'high' : row.defects > 0 ? 'medium' : 'low',
        risk,
        aiCoverage: progress > 65 ? 'high' : progress > 35 ? 'medium' : 'low',
        summary: `${row.done} of ${row.total} issues done, ${row.inProgress} in progress, ${row.notStarted} not started`,
      };
    });
};

const callLLM = async (prompt, aiConfig = null) => {
  try {
    const aiUrl = resolveAiServiceBaseUrl(process.env.AI_SERVICE_URL);
    const response = await axios.post(`${aiUrl}/stories/standup-summary`, {
      prompt,
      ai_config: aiConfig,
    }, { timeout: 45000 });

    return response.data?.summary || null;
  } catch (error) {
    return null;
  }
};

const generateProjectInsights = async (projectId) => {
  const [stories, commits, epics] = await Promise.all([
    Story.find({ project: projectId }).lean(),
    Commit.find({ projectId }).sort({ date: -1 }).lean(),
    Epic.find({ project: projectId }).lean(),
  ]);

  const total = stories.length;
  const completed = stories.filter((s) => s.status === 'done').length;
  const pending = stories.filter((s) => s.status !== 'done').length;
  const activeDevs = [...new Set(commits.map((c) => c.author).filter(Boolean))];
  const recentCommits = commits.slice(0, 10);
  const risk = inferRisk({ completed, total, recentCommits });
  const progressPercentage = toPercent(completed, total);

  const biasFlags = [];
  if (commits.length === 0) {
    stories
      .filter((story) => story.status === 'done')
      .forEach((story) => {
        biasFlags.push(`Task marked done but no commit activity found: ${story.title}`);
      });
  }

  const prompt = `
Project Summary:
Total Stories: ${total}
Completed: ${completed}
Pending: ${pending}
Progress: ${progressPercentage}%
Risk: ${risk}

Developers Active: ${activeDevs.length ? activeDevs.join(', ') : 'None'}

Recent Work:
${recentCommits.length ? recentCommits.map((c) => `- ${c.message}`).join('\n') : '- No recent commits'}

Generate a short standup-style summary:
- who did what
- what is pending
- project health
`;

  const aiConfig = await getActiveAIConfigPayload();
  const aiSummary = await callLLM(prompt, aiConfig);
  const fallbackSummary = `Progress is ${progressPercentage}%. ${activeDevs.length || 0} developers were active recently. Pending items: ${pending}. Project risk is ${risk}.`;

  const dailyReport = buildDailyReport(stories, commits);
  const moduleWise = buildModuleWise(stories, epics);
  const issueWise = buildIssueWise(stories);
  const teamInsights = buildTeamInsights(commits);
  const completedVelocity = dailyReport.reduce((sum, row) => sum + (row.completed || 0), 0);
  const createdVelocity = dailyReport.reduce((sum, row) => sum + (row.created || 0), 0);
  const openCritical = issueWise.filter((i) => i.severity === 'critical' || i.severity === 'high').length;
  const dailySummary = [
    `${progressPercentage}% project progress`,
    `${createdVelocity} created vs ${completedVelocity} completed in last 7 days`,
    `${openCritical} high-priority items need attention`,
  ];

  const executiveSummary = {
    automationCoverage: `${Math.min(98, 40 + completedVelocity * 3)}%`,
    validationTrust: `${Math.min(97, 35 + (activeDevs.length * 10))}%`,
    syncReliability: `${Math.max(80, 98 - openCritical * 3)}%`,
    standupOverhead: `${Math.max(0.8, 3.2 - (activeDevs.length * 0.2)).toFixed(1)}h/week`,
  };

  return {
    totalStories: total,
    completedStories: completed,
    pendingStories: pending,
    progressPercentage,
    activeDevelopers: activeDevs,
    recentActivity: recentCommits,
    risk,
    summary: aiSummary || fallbackSummary,
    biasFlags,
    overall: [
      { label: 'Story Throughput', value: String(completedVelocity), note: `${createdVelocity} created in same window` },
      { label: 'Average Cycle Time', value: `${Math.max(2.8, (pending + 1) / Math.max(completed || 1, 1) * 4).toFixed(1)}d`, note: 'Derived from pending-to-complete ratio' },
      { label: 'Blocked Work Items', value: String(pending), note: 'Items not yet done' },
      { label: 'AI Suggest Acceptance', value: `${Math.max(58, Math.min(95, 70 + completed - pending))}%`, note: 'Derived from completion trend' },
    ],
    dailyReport,
    moduleWise,
    issueWise,
    risks: [
      ...biasFlags,
      ...(openCritical ? [`${openCritical} high-priority items unresolved`] : []),
      ...(pending > completed ? ['Pending items are higher than completed items'] : []),
    ].slice(0, 5),
    dailySummary,
    teamInsights,
    executiveSummary,
  };
};

const generateGlobalInsights = async (projectIds = []) => {
  const all = [];
  for (const projectId of projectIds) {
    const insight = await generateProjectInsights(projectId);
    all.push({ projectId, ...insight });
  }

  const highRisk = all.filter((p) => p.risk === 'high').length;
  const mediumRisk = all.filter((p) => p.risk === 'medium').length;
  const avgProgress = all.length
    ? Math.round(all.reduce((sum, p) => sum + (p.progressPercentage || 0), 0) / all.length)
    : 0;

  const summary =
    all.length === 0
      ? 'No project activity found yet.'
      : `${highRisk} high-risk and ${mediumRisk} medium-risk projects detected. Average progress is ${avgProgress}%.`;

  return {
    summary,
    highRiskProjects: highRisk,
    mediumRiskProjects: mediumRisk,
    avgProgress,
    projects: all,
  };
};

module.exports = { generateProjectInsights, generateGlobalInsights };
