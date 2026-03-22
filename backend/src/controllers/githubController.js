const axios = require('axios');
const crypto = require('crypto');
const Project = require('../models/Project');
const Story = require('../models/Story');
const Commit = require('../models/Commit');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const aiService = require('../services/aiService');

const getDefaultRepoFromEnv = () => {
  const owner = (process.env.GITHUB_REPO_OWNER || '').trim();
  const name = (process.env.GITHUB_REPO_NAME || '').trim();
  if (!owner || !name) return '';
  return `${owner}/${name}`;
};

const getAutoRepoFromGitHub = async (userId) => {
  if (!userId) return '';

  const user = await User.findById(userId).select('+githubToken githubUsername');
  if (!user?.githubToken) return '';

  const headers = { Authorization: `token ${user.githubToken}`, 'User-Agent': 'DevTrack-App' };

  try {
    const response = await axios.get('https://api.github.com/user/repos?sort=updated&per_page=20&type=owner', { headers });
    const repos = Array.isArray(response.data) ? response.data : [];

    const preferredRepo =
      repos.find((repo) => !repo.archived && !repo.fork && repo.full_name) ||
      repos.find((repo) => !repo.archived && repo.full_name) ||
      repos.find((repo) => repo.full_name);

    return preferredRepo?.full_name || '';
  } catch (error) {
    return '';
  }
};

const ensureProjectGitHubLink = async (project, userId) => {
  if (!project) return null;
  if (project.githubConnected && project.githubRepo) return project;

  const fallbackRepo = getDefaultRepoFromEnv() || (await getAutoRepoFromGitHub(userId));
  if (!fallbackRepo) return project;

  project.githubRepo = fallbackRepo;
  project.githubBranch = project.githubBranch || 'main';
  project.githubConnected = true;
  await project.save();
  return project;
};

const getGitHubHeaders = async (userId) => {
  const user = await User.findById(userId).select('+githubToken');
  if (!user.githubToken) {
    const err = new Error('GitHub token not configured. Please add it in Settings.');
    err.statusCode = 400;
    throw err;
  }
  return { Authorization: `token ${user.githubToken}`, 'User-Agent': 'DevTrack-App' };
};

const persistCommit = async ({ projectId, commit, filesChanged = 0 }) => {
  if (!commit?.sha) return;

  await Commit.updateOne(
    { projectId, sha: commit.sha },
    {
      $set: {
        projectId,
        sha: commit.sha,
        message: commit.commit?.message || '',
        author: commit.commit?.author?.name || 'Unknown',
        date: commit.commit?.author?.date ? new Date(commit.commit.author.date) : new Date(),
        filesChanged,
      },
    },
    { upsert: true }
  );
};

// @desc    Connect GitHub repo to project
// @route   POST /api/github/connect/:projectId
// @access  Private
const connectRepo = async (req, res) => {
  const { githubRepo, githubBranch } = req.body;
  const resolvedRepo = githubRepo || getDefaultRepoFromEnv() || (await getAutoRepoFromGitHub(req.user.id));
  if (!resolvedRepo) {
    return res.status(400).json({ success: false, message: 'GitHub repo (owner/repo) is required' });
  }

  const headers = await getGitHubHeaders(req.user.id);

  // Verify repo access
  await axios.get(`https://api.github.com/repos/${resolvedRepo}`, { headers });

  const project = await Project.findByIdAndUpdate(
    req.params.projectId,
    { githubRepo: resolvedRepo, githubBranch: githubBranch || 'main', githubConnected: true },
    { new: true }
  );

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'github_connected',
    entity: 'project',
    entityId: project._id,
    details: { githubRepo: resolvedRepo, githubBranch },
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: project });
};

// @desc    Get recent commits
// @route   GET /api/github/commits/:projectId
// @access  Private
const getCommits = async (req, res) => {
  let project = await Project.findById(req.params.projectId);
  project = await ensureProjectGitHubLink(project, req.user.id);
  if (!project?.githubConnected || !project.githubRepo) {
    return res.status(200).json({ success: true, data: [], message: 'No repository linked yet for this project' });
  }

  const headers = await getGitHubHeaders(req.user.id);
  const response = await axios.get(
    `https://api.github.com/repos/${project.githubRepo}/commits?sha=${project.githubBranch}&per_page=20`,
    { headers }
  );

  // Persist commit activity for insight generation.
  await Promise.all(
    response.data.map(async (commit) => {
      let filesChanged = 0;
      try {
        const detail = await axios.get(
          `https://api.github.com/repos/${project.githubRepo}/commits/${commit.sha}`,
          { headers }
        );
        filesChanged = detail.data?.files?.length || 0;
      } catch (error) {
        filesChanged = 0;
      }

      await persistCommit({
        projectId: project._id,
        commit,
        filesChanged,
      });
    })
  );

  res.status(200).json({ success: true, data: response.data });
};

// @desc    Manually trigger code analysis
// @route   POST /api/github/analyze/:projectId
// @access  Private
const triggerAnalysis = async (req, res) => {
  let project = await Project.findById(req.params.projectId);
  project = await ensureProjectGitHubLink(project, req.user.id);
  if (!project?.githubConnected || !project.githubRepo) {
    return res.status(200).json({ success: true, message: 'No repository linked; analysis skipped' });
  }

  const headers = await getGitHubHeaders(req.user.id);

  // Get latest commit
  const commitsRes = await axios.get(
    `https://api.github.com/repos/${project.githubRepo}/commits?sha=${project.githubBranch}&per_page=5`,
    { headers }
  );

  const latestCommit = commitsRes.data[0];
  if (!latestCommit) {
    return res.status(200).json({ success: true, message: 'No commits found' });
  }

  // Get changed files
  const commitRes = await axios.get(
    `https://api.github.com/repos/${project.githubRepo}/commits/${latestCommit.sha}`,
    { headers }
  );

  await persistCommit({
    projectId: project._id,
    commit: latestCommit,
    filesChanged: commitRes.data?.files?.length || 0,
  });

  const changedFiles = commitRes.data.files.map((f) => ({
    filename: f.filename,
    status: f.status,
    patch: f.patch || '',
  }));

  // Get approved stories
  const stories = await Story.find({
    project: project._id,
    status: { $in: ['approved', 'to_do', 'in_progress'] },
  });

  if (stories.length === 0) {
    return res.status(200).json({ success: true, message: 'No stories to analyze' });
  }

  // Call AI service for analysis
  const analysisResults = await aiService.analyzeCode({
    projectId: project._id.toString(),
    changedFiles,
    stories: stories.map((s) => ({
      id: s._id.toString(),
      title: s.title,
      acceptanceCriteria: s.acceptanceCriteria.map((a) => a.criterion),
    })),
    commitSha: latestCommit.sha,
    commitMessage: latestCommit.commit.message,
  });

  // Update story statuses
  for (const result of (analysisResults.results || [])) {
    const story = await Story.findById(result.storyId);
    if (!story) continue;

    const update = {
      codeStatus: result.status,
      lastAnalyzedAt: new Date(),
    };

    if (result.evidence && result.evidence.length > 0) {
      update.$push = {
        codeEvidence: result.evidence.map((e) => ({
          ...e,
          commitSha: latestCommit.sha,
          commitMessage: latestCommit.commit.message,
          analyzedAt: new Date(),
        })),
      };
    }

    if (result.status === 'done') {
      update.status = 'done';
    } else if (result.status === 'partial' && story.status === 'to_do') {
      update.status = 'in_progress';
    }

    await Story.findByIdAndUpdate(story._id, update);
  }

  // Emit socket event
  const io = req.app.get('io');
  if (io) {
    io.to(`project:${project._id}`).emit('github:analyzed', {
      projectId: project._id,
      commitSha: latestCommit.sha,
      results: analysisResults.results,
    });
  }

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'github_push_analyzed',
    entity: 'project',
    entityId: project._id,
    details: { commitSha: latestCommit.sha, filesAnalyzed: changedFiles.length },
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: analysisResults });
};

// @desc    GitHub webhook receiver
// @route   POST /api/github/webhook/:projectId
// @access  Public (verified by signature)
const handleWebhook = async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const body = JSON.stringify(req.body);
  const expectedSig = `sha256=${crypto.createHmac('sha256', 'devtrack_webhook_secret').update(body).digest('hex')}`;

  if (signature !== expectedSig) {
    return res.status(401).json({ message: 'Invalid webhook signature' });
  }

  if (req.headers['x-github-event'] === 'push') {
    const project = await Project.findById(req.params.projectId);
    if (project) {
      // Trigger async analysis (don't block webhook response)
      triggerAnalysisFromWebhook(project, req.body, req.app.get('io')).catch(console.error);
    }
  }

  res.status(200).json({ success: true });
};

const triggerAnalysisFromWebhook = async (project, payload, io) => {
  // Lightweight trigger for webhook-based analysis
  if (io) {
    io.to(`project:${project._id}`).emit('github:push', {
      projectId: project._id,
      pusher: payload.pusher?.name,
      commits: payload.commits?.length || 0,
    });
  }
};

module.exports = { connectRepo, getCommits, triggerAnalysis, handleWebhook };
