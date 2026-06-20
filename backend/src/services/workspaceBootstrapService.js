const Organization = require('../models/Organization');

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
};

module.exports = { ensureUserWorkspace };
