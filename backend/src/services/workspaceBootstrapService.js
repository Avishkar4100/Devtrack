const Project = require('../models/Project');
const Organization = require('../models/Organization');

const buildProjectKey = (name = 'PROJECT') => {
  const compact = String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return (compact || 'PROJECT').slice(0, 8);
};

const ensureUniqueProjectKey = async (ownerId, seedName) => {
  const base = buildProjectKey(seedName);
  let attempt = 0;

  while (attempt < 50) {
    const suffix = attempt === 0 ? '' : String(attempt + 1);
    const candidate = `${base}${suffix}`.slice(0, 10);
    const exists = await Project.exists({ owner: ownerId, key: candidate });
    if (!exists) return candidate;
    attempt += 1;
  }

  return `${base}${Date.now().toString().slice(-2)}`.slice(0, 10);
};

const ensureUserWorkspace = async (user) => {
  if (!user?._id || user.role === 'admin') return;

  const userId = user._id;

  const existingOrg = await Organization.findOne({ owner: userId });
  if (!existingOrg) {
    await Organization.create({
      name: `${user.name || 'User'} Workspace`,
      domain: `user-${String(userId)}.local`,
      owner: userId,
      isActive: true,
    });
  }

  const existingProject = await Project.findOne({ owner: userId });
  if (!existingProject) {
    const key = await ensureUniqueProjectKey(userId, user.name || 'Project');
    await Project.create({
      name: `${user.name || 'My'} Project`,
      description: 'Auto-created personal project workspace.',
      key,
      owner: userId,
      status: 'planning',
    });
  }
};

module.exports = { ensureUserWorkspace };