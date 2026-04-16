const Project = require('../models/Project');
const User = require('../models/User');
const Epic = require('../models/Epic');
const Story = require('../models/Story');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');
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

// @desc    Get all projects for current user
// @route   GET /api/projects
// @access  Private
const getProjects = async (req, res) => {
  const filter = req.user.role === 'admin'
    ? {}
    : { $or: [{ owner: req.user.id }, { 'members.user': req.user.id }] };

  const projects = await Project.find(filter)
    .populate('owner', 'name email avatar')
    .populate('members.user', 'name email avatar')
    .sort('-createdAt');

  res.status(200).json({ success: true, count: projects.length, data: projects });
};

// @desc    Get single project
// @route   GET /api/projects/:id
// @access  Private
const getProject = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

  const baseCriteria = { _id: req.params.id };
  const accessCriteria = req.user.role === 'admin'
    ? baseCriteria
    : {
      ...baseCriteria,
      $or: [{ owner: req.user._id }, { 'members.user': req.user._id }],
    };

  const project = await Project.findOne(accessCriteria)
    .populate('owner', 'name email avatar role')
    .populate('members.user', 'name email avatar role');

  if (!project) {
    const exists = await Project.exists({ _id: req.params.id });
    if (!exists) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    return res.status(403).json({ success: false, message: 'Not authorized to view this project' });
  }

  res.status(200).json({ success: true, data: project });
};

// @desc    Create project
// @route   POST /api/projects
// @access  Private
const createProject = async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ success: false, message: 'Admin accounts cannot create user workspace projects here' });
  }

  const { name, description, key, budget, deadline, technology, color, tags } = req.body;

  const fallbackKey = (name || 'PROJECT')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10) || 'PROJECT';

  const defaultRepoOwner = (process.env.GITHUB_REPO_OWNER || '').trim();
  const defaultRepoName = (process.env.GITHUB_REPO_NAME || '').trim();
  const defaultGithubRepo = defaultRepoOwner && defaultRepoName ? `${defaultRepoOwner}/${defaultRepoName}` : undefined;

  const project = await Project.create({
    name,
    description,
    key: (key || fallbackKey).toUpperCase(),
    owner: req.user.id,
    budget,
    deadline,
    technology,
    color,
    tags,
    githubRepo: defaultGithubRepo,
    githubConnected: Boolean(defaultGithubRepo),
  });

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'project_created',
    entity: 'project',
    entityId: project._id,
    details: { name: project.name, key: project.key },
    ipAddress: req.ip,
  });

  await project.populate('owner', 'name email avatar');

  res.status(201).json({ success: true, data: project });
};

// @desc    Update project
// @route   PUT /api/projects/:id
// @access  Private
const updateProject = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

  let project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const ownerId = toIdString(project.owner);
  if (ownerId !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Not authorized to update this project' });
  }

  const allowedFields = ['name', 'description', 'budget', 'deadline', 'technology', 'status', 'color', 'tags', 'githubRepo', 'githubBranch'];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) project[field] = req.body[field];
  });

  await project.save();

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'project_updated',
    entity: 'project',
    entityId: project._id,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: project });
};

// @desc    Delete project
// @route   DELETE /api/projects/:id
// @access  Private
const deleteProject = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid project id' });
  }

  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const ownerId = toIdString(project.owner);
  if (ownerId !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Not authorized to delete this project' });
  }

  await project.deleteOne();
  res.status(200).json({ success: true, message: 'Project deleted' });
};

// @desc    Invite member to project
// @route   POST /api/projects/:id/invite
// @access  Private
const inviteMember = async (req, res) => {
  const { email, role } = req.body;

  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const ownerId = toIdString(project.owner);
  if (req.user.role !== 'scrum_master' || ownerId !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const userToInvite = await User.findOne({ email });
  if (!userToInvite) {
    return res.status(404).json({ success: false, message: 'No user found with that email' });
  }

  const alreadyMember =
    ownerId === userToInvite._id.toString() ||
    project.members.some((m) => toIdString(m?.user) === userToInvite._id.toString());

  if (alreadyMember) {
    return res.status(400).json({ success: false, message: 'User is already a member of this project' });
  }

  project.members.push({ user: userToInvite._id, role: role || 'manager' });
  await project.save();

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'member_invited',
    entity: 'project',
    entityId: project._id,
    details: { invitedUser: userToInvite.email, role },
    ipAddress: req.ip,
  });

  await project.populate('members.user', 'name email avatar');

  res.status(200).json({ success: true, data: project.members });
};

// @desc    Remove member from project
// @route   DELETE /api/projects/:id/members/:userId
// @access  Private
const removeMember = async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const ownerId = toIdString(project.owner);
  if (ownerId !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Only the project owner can remove members' });
  }

  project.members = project.members.filter(
    (m) => toIdString(m?.user) !== req.params.userId
  );
  await project.save();

  res.status(200).json({ success: true, message: 'Member removed' });
};

// @desc    Get project audit log
// @route   GET /api/projects/:id/audit
// @access  Private
const getAuditLog = async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  const logs = await AuditLog.find({ project: req.params.id })
    .populate('user', 'name email avatar')
    .sort('-createdAt')
    .limit(100);

  res.status(200).json({ success: true, count: logs.length, data: logs });
};

// @desc    Get assignable users for a project
// @route   GET /api/projects/:id/users
// @access  Private
const getProjectUsers = async (req, res) => {
  const project = await Project.findById(req.params.id)
    .populate('owner', 'name email avatar role')
    .populate('members.user', 'name email avatar role');

  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const users = [];
  if (project.owner?._id) {
    users.push({
      _id: project.owner._id,
      name: project.owner.name,
      email: project.owner.email,
      avatar: project.owner.avatar,
      role: 'owner',
    });
  }

  project.members.forEach((member) => {
    if (!member?.user?._id) return;
    if (users.some((u) => String(u._id) === String(member.user._id))) return;
    users.push({
      _id: member.user._id,
      name: member.user.name,
      email: member.user.email,
      avatar: member.user.avatar,
      role: member.role || member.user.role || 'member',
    });
  });

  res.status(200).json({ success: true, count: users.length, data: users });
};

module.exports = {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  inviteMember,
  removeMember,
  getAuditLog,
  getProjectUsers,
};
