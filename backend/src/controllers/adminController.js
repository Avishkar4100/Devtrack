const User = require('../models/User');
const Project = require('../models/Project');
const Story = require('../models/Story');
const Document = require('../models/Document');
const AuditLog = require('../models/AuditLog');
const AIConfig = require('../models/AIConfig');
const Organization = require('../models/Organization');
const logger = require('../config/logger');

const SUPPORTED_AI_PROVIDERS = ['openrouter', 'deepseek_local'];

const getOpenrouterKeyNames = () => Object.keys(process.env)
  .filter((k) => /^OPENROUTER_API_KEY(_\d+)?$/.test(k))
  .sort((a, b) => a.localeCompare(b));

const normalizeAIConfig = (cfg, userId, index = 0) => {
  let changed = false;
  if (!SUPPORTED_AI_PROVIDERS.includes(cfg.provider)) {
    cfg.provider = 'openrouter';
    changed = true;
  }
  if (!cfg.name || !cfg.name.trim()) {
    cfg.name = index === 0 ? 'Default OpenRouter' : `AI Config ${index + 1}`;
    changed = true;
  }
  if (!cfg.openrouterKeyName) {
    cfg.openrouterKeyName = 'OPENROUTER_API_KEY';
    changed = true;
  }
  if (!cfg.openrouterModel) {
    cfg.openrouterModel = process.env.LLM_MODEL || 'google/gemma-3-27b-it:free';
    changed = true;
  }
  if (!cfg.deepseekModel) {
    cfg.deepseekModel = 'deepseek-chat';
    changed = true;
  }
  if (!cfg.maxTokens || Number(cfg.maxTokens) < 4096) {
    cfg.maxTokens = 4096;
    changed = true;
  }
  if (changed && userId) {
    cfg.updatedBy = userId;
  }
  return changed;
};

const ensureAIConfigs = async (userId = null) => {
  let configs = await AIConfig.find({}).sort({ createdAt: 1 });

  if (configs.length === 0) {
    const created = await AIConfig.create({
      name: 'Default OpenRouter',
      provider: 'openrouter',
      openrouterKeyName: 'OPENROUTER_API_KEY',
      openrouterModel: process.env.LLM_MODEL || 'google/gemma-3-27b-it:free',
      deepseekUrl: process.env.DEEPSEEK_LOCAL_URL || '',
      deepseekModel: 'deepseek-chat',
      isActive: true,
      updatedBy: userId || undefined,
    });
    return [created];
  }

  const saves = [];
  let seenActive = false;
  configs.forEach((cfg, idx) => {
    let changed = normalizeAIConfig(cfg, userId, idx);
    if (cfg.isActive && !seenActive) {
      seenActive = true;
    } else if (cfg.isActive && seenActive) {
      cfg.isActive = false;
      changed = true;
    }
    if (changed) saves.push(cfg.save());
  });

  if (!seenActive && configs[0]) {
    configs[0].isActive = true;
    if (userId) configs[0].updatedBy = userId;
    saves.push(configs[0].save());
  }

  if (saves.length) await Promise.all(saves);
  return AIConfig.find({}).sort({ createdAt: 1 });
};

const buildAIConfigPayload = (body = {}) => {
  const allowed = [
    'name',
    'provider',
    'openrouterKeyName',
    'openrouterModel',
    'deepseekUrl',
    'deepseekModel',
    'temperature',
    'maxTokens',
    'isActive',
  ];
  const payload = {};
  allowed.forEach((k) => {
    if (body[k] !== undefined) payload[k] = body[k];
  });

  if (payload.name !== undefined) payload.name = String(payload.name).trim();
  if (payload.provider !== undefined && !SUPPORTED_AI_PROVIDERS.includes(payload.provider)) {
    throw new Error('Invalid provider. Allowed values: openrouter, deepseek_local');
  }
  return payload;
};

// @desc    Admin platform overview stats
// @route   GET /api/admin/overview
// @access  Private (Admin)
const getAdminOverview = async (req, res) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    activeUsers,
    newUsers,
    totalProjects,
    activeProjects,
    totalStories,
    aiGeneratedStories,
    processedDocuments,
    activeOrganizations,
    usageByDay,
    topActions,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isActive: true }),
    User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    Project.countDocuments({}),
    Project.countDocuments({ status: 'active' }),
    Story.countDocuments({}),
    Story.countDocuments({ aiGenerated: true }),
    Document.countDocuments({ status: 'processed' }),
    Organization.countDocuments({ isActive: true }),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  res.status(200).json({
    success: true,
    data: {
      users: { total: totalUsers, active: activeUsers, joinedLast30Days: newUsers },
      organizations: { active: activeOrganizations },
      projects: { total: totalProjects, running: activeProjects },
      usage: {
        totalStories,
        aiGeneratedStories,
        processedDocuments,
        usageByDay,
        topActions,
      },
    },
  });
};

// @desc    Get AI config
// @route   GET /api/admin/ai-config
// @access  Private (Admin)
const getAIConfig = async (req, res) => {
  const configs = await ensureAIConfigs(req.user.id);
  const activeConfig = configs.find((cfg) => cfg.isActive) || null;

  res.status(200).json({
    success: true,
    data: {
      config: activeConfig,
      activeConfig,
      configs,
      options: {
        providers: SUPPORTED_AI_PROVIDERS,
        openrouterKeyNames: getOpenrouterKeyNames(),
        defaultOpenrouterModel: process.env.LLM_MODEL || 'google/gemma-3-27b-it:free',
        deepseekDefaultUrl: process.env.DEEPSEEK_LOCAL_URL || '',
      },
    },
  });
};

// @desc    Update AI config
// @route   PUT /api/admin/ai-config
// @access  Private (Admin)
const updateAIConfig = async (req, res) => {
  let updates;
  try {
    updates = buildAIConfigPayload(req.body);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  updates.updatedBy = req.user.id;

  const configs = await ensureAIConfigs(req.user.id);
  const cfg = configs.find((c) => c.isActive) || configs[0];
  Object.assign(cfg, updates);

  if (updates.isActive === true) {
    await AIConfig.updateMany({ _id: { $ne: cfg._id } }, { $set: { isActive: false } });
  }

  await cfg.save();

  logger.info(`Admin AI config updated by user ${req.user.id}`);
  res.status(200).json({ success: true, data: cfg, message: 'AI configuration updated' });
};

// @desc    Create AI config
// @route   POST /api/admin/ai-config
// @access  Private (Admin)
const createAIConfig = async (req, res) => {
  let payload;
  try {
    payload = buildAIConfigPayload(req.body);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }

  if (!payload.name) {
    return res.status(400).json({ success: false, message: 'name is required' });
  }

  payload.updatedBy = req.user.id;
  payload.provider = payload.provider || 'openrouter';
  payload.openrouterKeyName = payload.openrouterKeyName || 'OPENROUTER_API_KEY';
  payload.openrouterModel = payload.openrouterModel || process.env.LLM_MODEL || 'google/gemma-3-27b-it:free';
  payload.deepseekModel = payload.deepseekModel || 'deepseek-chat';

  const shouldActivate = payload.isActive === true;
  const created = await AIConfig.create(payload);

  if (shouldActivate) {
    await AIConfig.updateMany({ _id: { $ne: created._id } }, { $set: { isActive: false } });
  } else {
    const activeCount = await AIConfig.countDocuments({ isActive: true });
    if (activeCount === 0) {
      created.isActive = true;
      await created.save();
    }
  }

  const finalDoc = await AIConfig.findById(created._id);
  res.status(201).json({ success: true, data: finalDoc, message: 'AI configuration created' });
};

// @desc    Update AI config by id
// @route   PUT /api/admin/ai-config/:id
// @access  Private (Admin)
const updateAIConfigById = async (req, res) => {
  const cfg = await AIConfig.findById(req.params.id);
  if (!cfg) return res.status(404).json({ success: false, message: 'AI config not found' });

  let updates;
  try {
    updates = buildAIConfigPayload(req.body);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }

  Object.assign(cfg, updates, { updatedBy: req.user.id });

  if (updates.isActive === true) {
    await AIConfig.updateMany({ _id: { $ne: cfg._id } }, { $set: { isActive: false } });
  }

  await cfg.save();
  res.status(200).json({ success: true, data: cfg, message: 'AI configuration updated' });
};

// @desc    Activate AI config
// @route   PUT /api/admin/ai-config/:id/activate
// @access  Private (Admin)
const activateAIConfig = async (req, res) => {
  const cfg = await AIConfig.findById(req.params.id);
  if (!cfg) return res.status(404).json({ success: false, message: 'AI config not found' });

  await AIConfig.updateMany({}, { $set: { isActive: false } });
  cfg.isActive = true;
  cfg.updatedBy = req.user.id;
  await cfg.save();

  res.status(200).json({ success: true, data: cfg, message: 'AI configuration activated' });
};

// @desc    Delete AI config
// @route   DELETE /api/admin/ai-config/:id
// @access  Private (Admin)
const deleteAIConfig = async (req, res) => {
  const cfg = await AIConfig.findById(req.params.id);
  if (!cfg) return res.status(404).json({ success: false, message: 'AI config not found' });

  const total = await AIConfig.countDocuments({});
  if (total <= 1) {
    return res.status(400).json({ success: false, message: 'At least one AI configuration must exist' });
  }

  const wasActive = cfg.isActive;
  await cfg.deleteOne();

  if (wasActive) {
    const next = await AIConfig.findOne({}).sort({ updatedAt: -1 });
    if (next) {
      next.isActive = true;
      next.updatedBy = req.user.id;
      await next.save();
    }
  }

  res.status(200).json({ success: true, message: 'AI configuration deleted' });
};

// @desc    List users
// @route   GET /api/admin/users
// @access  Private (Admin)
const listUsers = async (req, res) => {
  const users = await User.find({}).select('-password').sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: users.length, data: users });
};

// @desc    Create user
// @route   POST /api/admin/users
// @access  Private (Admin)
const createUser = async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'name, email and password are required' });
  }

  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ success: false, message: 'Email already exists' });

  const user = await User.create({
    name,
    email,
    password,
    role: role || 'developer',
    isEmailVerified: true,
  });

  res.status(201).json({ success: true, data: { id: user._id, name: user.name, email: user.email, role: user.role } });
};

// @desc    Update user
// @route   PUT /api/admin/users/:id
// @access  Private (Admin)
const updateUser = async (req, res) => {
  const user = await User.findById(req.params.id).select('+password');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const allowed = ['name', 'email', 'role', 'isActive', 'password'];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) user[field] = req.body[field];
  });

  await user.save();
  res.status(200).json({ success: true, data: { id: user._id, name: user.name, email: user.email, role: user.role, isActive: user.isActive } });
};

// @desc    Deactivate user
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
const deleteUser = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  user.isActive = false;
  await user.save({ validateBeforeSave: false });
  res.status(200).json({ success: true, message: 'User deactivated' });
};

// @desc    List organizations
// @route   GET /api/admin/organizations
// @access  Private (Admin)
const listOrganizations = async (req, res) => {
  const orgs = await Organization.find({}).populate('owner', 'name email').sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: orgs.length, data: orgs });
};

// @desc    Create organization
// @route   POST /api/admin/organizations
// @access  Private (Admin)
const createOrganization = async (req, res) => {
  const { name, domain, owner } = req.body;
  if (!name || !domain || !owner) {
    return res.status(400).json({ success: false, message: 'name, domain and owner are required' });
  }

  const org = await Organization.create({ name, domain, owner, isActive: true });
  res.status(201).json({ success: true, data: org });
};

// @desc    Update organization
// @route   PUT /api/admin/organizations/:id
// @access  Private (Admin)
const updateOrganization = async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

  const allowed = ['name', 'domain', 'owner', 'isActive'];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) org[field] = req.body[field];
  });

  await org.save();
  res.status(200).json({ success: true, data: org });
};

// @desc    Delete organization
// @route   DELETE /api/admin/organizations/:id
// @access  Private (Admin)
const deleteOrganization = async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

  await org.deleteOne();
  res.status(200).json({ success: true, message: 'Organization deleted' });
};

// @desc    List projects
// @route   GET /api/admin/projects
// @access  Private (Admin)
const listProjects = async (req, res) => {
  const projects = await Project.find({})
    .populate('owner', 'name email role')
    .sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: projects.length, data: projects });
};

// @desc    Create project
// @route   POST /api/admin/projects
// @access  Private (Admin)
const createProject = async (req, res) => {
  const { name, key, owner, status, description, technology, budget, deadline } = req.body;
  if (!name || !key || !owner) {
    return res.status(400).json({ success: false, message: 'name, key and owner are required' });
  }

  const existing = await Project.findOne({ owner, key: String(key).toUpperCase() });
  if (existing) {
    return res.status(400).json({ success: false, message: 'Project key already exists for this owner' });
  }

  const project = await Project.create({
    name,
    key: String(key).toUpperCase(),
    owner,
    status: status || 'planning',
    description,
    technology,
    budget,
    deadline,
  });

  res.status(201).json({ success: true, data: project });
};

// @desc    Update project
// @route   PUT /api/admin/projects/:id
// @access  Private (Admin)
const updateProject = async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const allowed = ['name', 'description', 'status', 'owner', 'technology', 'budget', 'deadline', 'color'];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) project[field] = req.body[field];
  });

  if (req.body.key !== undefined) {
    project.key = String(req.body.key).toUpperCase();
  }

  await project.save();
  res.status(200).json({ success: true, data: project });
};

// @desc    Delete project
// @route   DELETE /api/admin/projects/:id
// @access  Private (Admin)
const deleteProject = async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  await project.deleteOne();
  res.status(200).json({ success: true, message: 'Project deleted' });
};

module.exports = {
  getAdminOverview,
  getAIConfig,
  updateAIConfig,
  createAIConfig,
  updateAIConfigById,
  activateAIConfig,
  deleteAIConfig,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
};
