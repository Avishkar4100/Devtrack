const axios = require('axios');
const Story = require('../models/Story');
const Commit = require('../models/Commit');

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

const callLLM = async (prompt) => {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: process.env.INSIGHT_MODEL || process.env.LLM_MODEL || 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'system',
            content: 'You are an engineering manager assistant. Keep summaries factual, concise, and neutral.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 180,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
          'X-Title': 'DevTrack Insights',
        },
        timeout: 30000,
      }
    );

    return response.data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    return null;
  }
};

const generateProjectInsights = async (projectId) => {
  const [stories, commits] = await Promise.all([
    Story.find({ project: projectId }).lean(),
    Commit.find({ projectId }).sort({ date: -1 }).lean(),
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

  const aiSummary = await callLLM(prompt);
  const fallbackSummary = `Progress is ${progressPercentage}%. ${activeDevs.length || 0} developers were active recently. Pending items: ${pending}. Project risk is ${risk}.`;

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
