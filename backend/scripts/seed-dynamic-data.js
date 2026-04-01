require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const Epic = require('../src/models/Epic');
const Story = require('../src/models/Story');
const Sprint = require('../src/models/Sprint');
const Commit = require('../src/models/Commit');
const Document = require('../src/models/Document');
const Requirement = require('../src/models/Requirement');

const getArgValue = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length);
};

const getRangeDate = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
};

const toCriterion = (text) => ({ criterion: text, met: false });

const ensureProject = async (user, projectKey, projectName) => {
  const existing = await Project.findOne({ owner: user._id, key: projectKey.toUpperCase() });
  if (existing) return existing;

  return Project.create({
    owner: user._id,
    name: projectName,
    key: projectKey.toUpperCase(),
    description: 'Seeded dynamic project data for end-to-end workspace and insights validation',
    status: 'active',
    completionPercentage: 0,
    totalStories: 0,
    completedStories: 0,
    inProgressStories: 0,
    color: '#2563eb',
    technology: 'Node.js, React, FastAPI, MongoDB',
    deadline: getRangeDate(-21),
  });
};

const seedSprints = async (projectId) => {
  await Sprint.deleteMany({ project: projectId });

  const sprints = [
    {
      project: projectId,
      name: 'Sprint S1 - Foundation',
      goal: 'Set up patient registration, appointments, and baseline billing flows',
      status: 'completed',
      startDate: getRangeDate(28),
      endDate: getRangeDate(14),
      velocityPlanned: 24,
      velocityActual: 21,
      order: 1,
      burndownData: [
        { date: getRangeDate(28), planned: 24, actual: 24 },
        { date: getRangeDate(24), planned: 18, actual: 20 },
        { date: getRangeDate(20), planned: 10, actual: 12 },
        { date: getRangeDate(16), planned: 0, actual: 3 },
      ],
    },
    {
      project: projectId,
      name: 'Sprint S2 - Automation',
      goal: 'Improve Jira sync quality and traceability from commits',
      status: 'active',
      startDate: getRangeDate(13),
      endDate: getRangeDate(-1),
      velocityPlanned: 28,
      velocityActual: 17,
      order: 2,
      burndownData: [
        { date: getRangeDate(13), planned: 28, actual: 28 },
        { date: getRangeDate(10), planned: 20, actual: 23 },
        { date: getRangeDate(7), planned: 12, actual: 17 },
        { date: getRangeDate(3), planned: 4, actual: 10 },
      ],
    },
  ];

  await Sprint.insertMany(sprints);
};

const seedDocsAndRequirements = async (userId, projectId) => {
  await Document.deleteMany({ project: projectId });
  await Requirement.deleteMany({ project: projectId });

  const doc = await Document.create({
    project: projectId,
    uploadedBy: userId,
    name: 'hospital-management-srs-v1.md',
    originalName: 'hospital-management-srs-v1.md',
    fileType: 'md',
    filePath: 'seed/hospital-management-srs-v1.md',
    fileSize: 18456,
    status: 'processed',
    isActive: true,
    version: 1,
    vectorNamespace: `project-${projectId}`,
    ingestionStatus: {
      chunks: 64,
      embeddings: 64,
      processingTime: 8200,
      errorMessage: '',
    },
  });

  await Requirement.create({
    project: projectId,
    document: doc._id,
    source: 'seed_extract',
    modules: ['Patient Management', 'Appointment Scheduling', 'Billing and Invoicing', 'Doctor Allocation'],
    actors: ['Receptionist', 'Doctor', 'Billing Staff', 'Administrator'],
    functional: [
      'FR-1 Create patient records with contact and medical profile',
      'FR-2 Book and reschedule appointments with doctor availability checks',
      'FR-3 Generate invoices and record payment status',
      'FR-4 Export daily operations report',
    ],
    nonFunctional: [
      'NFR-1 Dashboard pages should load in under 2 seconds',
      'NFR-2 Auditability for story to commit traceability',
      'NFR-3 Role-based access for admin and staff',
    ],
  });
};

const seedBacklog = async (userId, project) => {
  await Epic.deleteMany({ project: project._id });
  await Story.deleteMany({ project: project._id });

  const epics = await Epic.insertMany([
    {
      project: project._id,
      title: 'Patient Lifecycle Core',
      description: 'Patient registration, profile updates, and intake workflows.',
      epicKey: `${project.key}-EPIC-1`,
      status: 'approved',
      priority: 'high',
      sprint: 'S1',
      aiGenerated: true,
      order: 1,
      pushedToJira: true,
      pushedAt: new Date(),
      jiraEpicKey: `${project.jiraProjectKey || 'DMS1'}-100`,
    },
    {
      project: project._id,
      title: 'Appointments and Billing Automation',
      description: 'Scheduling, reminders, billing, and payment tracking.',
      epicKey: `${project.key}-EPIC-2`,
      status: 'in_progress',
      priority: 'high',
      sprint: 'S2',
      aiGenerated: true,
      order: 2,
      pushedToJira: true,
      pushedAt: new Date(),
      jiraEpicKey: `${project.jiraProjectKey || 'DMS1'}-101`,
    },
  ]);

  const [epicA, epicB] = epics;

  const storyRows = await Story.insertMany([
    {
      project: project._id,
      epic: epicA._id,
      type: 'story',
      title: 'As receptionist, I can register a patient with mandatory validation',
      description: 'Collect demographics and contact details with validation rules.',
      storyKey: `${project.key}-1`,
      acceptanceCriteria: [
        toCriterion('Required patient fields are validated before submit'),
        toCriterion('Duplicate phone number is flagged with clear message'),
      ],
      status: 'done',
      codeStatus: 'done',
      priority: 'high',
      storyPoints: 5,
      sprint: 'S1',
      assignee: userId,
      reporter: userId,
      aiGenerated: true,
      pushedToJira: true,
      pushedAt: new Date(),
      jiraIssueKey: `${project.jiraProjectKey || 'DMS1'}-201`,
      labels: ['patient', 'registration'],
      startDate: getRangeDate(27),
      dueDate: getRangeDate(21),
      estimatedHours: 12,
      loggedHours: 13,
      order: 1,
    },
    {
      project: project._id,
      epic: epicA._id,
      type: 'task',
      title: 'Implement patient profile persistence and audit trail',
      description: 'Persist patient updates and write audit snapshots.',
      storyKey: `${project.key}-2`,
      acceptanceCriteria: [
        toCriterion('Profile updates preserve previous values in audit entries'),
      ],
      status: 'done',
      codeStatus: 'done',
      priority: 'medium',
      storyPoints: 3,
      sprint: 'S1',
      assignee: userId,
      reporter: userId,
      aiGenerated: true,
      pushedToJira: true,
      pushedAt: new Date(),
      jiraIssueKey: `${project.jiraProjectKey || 'DMS1'}-202`,
      labels: ['patient', 'audit'],
      startDate: getRangeDate(24),
      dueDate: getRangeDate(19),
      estimatedHours: 8,
      loggedHours: 7,
      order: 2,
    },
    {
      project: project._id,
      epic: epicB._id,
      type: 'story',
      title: 'As staff, I can schedule appointments with conflict detection',
      description: 'Prevent overlap and suggest nearest available slot.',
      storyKey: `${project.key}-3`,
      acceptanceCriteria: [
        toCriterion('Overlapping doctor slots are blocked'),
        toCriterion('Alternative slots are suggested in same panel'),
      ],
      status: 'in_progress',
      codeStatus: 'partial',
      priority: 'high',
      storyPoints: 8,
      sprint: 'S2',
      assignee: userId,
      reporter: userId,
      aiGenerated: true,
      pushedToJira: true,
      pushedAt: new Date(),
      jiraIssueKey: `${project.jiraProjectKey || 'DMS1'}-203`,
      labels: ['appointment'],
      startDate: getRangeDate(12),
      dueDate: getRangeDate(-2),
      estimatedHours: 16,
      loggedHours: 10,
      order: 3,
      codeEvidence: [
        {
          filePath: 'frontend/src/pages/Workspace.jsx',
          lineStart: 120,
          lineEnd: 184,
          commitSha: 'a1b2c3d4',
          commitMessage: 'feat: add appointment conflict detection UI',
        },
      ],
      lastAnalyzedAt: getRangeDate(1),
    },
    {
      project: project._id,
      epic: epicB._id,
      type: 'task',
      title: 'Sync appointment status updates to Jira workflow',
      description: 'Move linked issues between To Do / In Progress / Done.',
      storyKey: `${project.key}-4`,
      acceptanceCriteria: [
        toCriterion('Status transitions map to Jira workflow states'),
      ],
      status: 'in_review',
      codeStatus: 'partial',
      priority: 'high',
      storyPoints: 5,
      sprint: 'S2',
      assignee: userId,
      reporter: userId,
      aiGenerated: true,
      pushedToJira: true,
      pushedAt: new Date(),
      jiraIssueKey: `${project.jiraProjectKey || 'DMS1'}-204`,
      labels: ['jira-sync'],
      startDate: getRangeDate(11),
      dueDate: getRangeDate(-1),
      estimatedHours: 10,
      loggedHours: 7,
      order: 4,
    },
    {
      project: project._id,
      epic: epicB._id,
      type: 'story',
      title: 'As billing staff, I can generate invoice for completed visit',
      description: 'Build invoice from treatment, consultation, and discounts.',
      storyKey: `${project.key}-5`,
      acceptanceCriteria: [
        toCriterion('Invoice line items are auto-calculated from treatment data'),
      ],
      status: 'to_do',
      codeStatus: 'not_started',
      priority: 'medium',
      storyPoints: 5,
      sprint: 'S2',
      assignee: userId,
      reporter: userId,
      aiGenerated: true,
      pushedToJira: true,
      pushedAt: new Date(),
      jiraIssueKey: `${project.jiraProjectKey || 'DMS1'}-205`,
      labels: ['billing'],
      startDate: getRangeDate(-2),
      dueDate: getRangeDate(-8),
      estimatedHours: 10,
      loggedHours: 0,
      order: 5,
    },
    {
      project: project._id,
      epic: epicB._id,
      type: 'task',
      title: 'Add doctor schedule weekly export report',
      description: 'Generate CSV export for admin reporting.',
      storyKey: `${project.key}-6`,
      acceptanceCriteria: [toCriterion('CSV includes doctor, day, slot, and appointment count')],
      status: 'to_do',
      codeStatus: 'not_started',
      priority: 'low',
      storyPoints: 2,
      sprint: 'backlog',
      assignee: userId,
      reporter: userId,
      aiGenerated: false,
      pushedToJira: false,
      labels: ['report'],
      startDate: getRangeDate(-1),
      dueDate: getRangeDate(-12),
      estimatedHours: 4,
      loggedHours: 0,
      order: 6,
    },
  ]);

  const parentTask = storyRows.find((s) => s.storyKey === `${project.key}-4`);

  await Story.create({
    project: project._id,
    epic: epicB._id,
    parentStory: parentTask?._id,
    type: 'subtask',
    title: 'Map DevTrack in_review to Jira In Review',
    description: 'Transition mapping for review state before done.',
    storyKey: `${project.key}-7`,
    acceptanceCriteria: [toCriterion('Transition is skipped when issue already in target state')],
    status: 'in_progress',
    codeStatus: 'partial',
    priority: 'medium',
    storyPoints: 1,
    sprint: 'S2',
    assignee: userId,
    reporter: userId,
    aiGenerated: true,
    pushedToJira: true,
    pushedAt: new Date(),
    jiraIssueKey: `${project.jiraProjectKey || 'DMS1'}-206`,
    labels: ['jira-sync', 'subtask'],
    startDate: getRangeDate(8),
    dueDate: getRangeDate(-1),
    estimatedHours: 3,
    loggedHours: 2,
    order: 7,
  });
};

const seedCommits = async (projectId) => {
  await Commit.deleteMany({ projectId });

  const commits = [
    'feat(patient): add registration validation and dedupe checks',
    'fix(auth): guard invalid token refresh on inactive account',
    'feat(appointments): slot conflict detector for doctor schedule',
    'feat(jira): connect backlog push with issue transition mapping',
    'chore(ui): stabilize overview project sync state update',
    'feat(insights): compute risk board from project summary endpoint',
    'fix(sync): retry logic for jira issue updates on transient failures',
    'feat(planner): support fallback suggestions when provider fails',
    'refactor(workspace): consolidate control tower KPI rendering',
    'test(api): add integration checks for stories save and jira push',
    'feat(docs): persist processed SRS metadata and requirement extraction',
    'fix(commits): avoid duplicate commit import by sha',
  ];

  const rows = commits.map((message, idx) => ({
    projectId,
    sha: `seed${String(idx + 1).padStart(4, '0')}abcdef`,
    message,
    author: idx % 2 === 0 ? 'Akshay Ghule' : 'Tejas Patil',
    date: getRangeDate(12 - idx),
    filesChanged: (idx % 5) + 1,
  }));

  await Commit.insertMany(rows);
};

const recomputeMetrics = async (project) => {
  const stories = await Story.find({ project: project._id, type: { $in: ['story', 'task'] } }).lean();
  const total = stories.length;
  const completed = stories.filter((s) => s.status === 'done').length;
  const inProgress = stories.filter((s) => s.status === 'in_progress').length;
  const completionPercentage = total ? Math.round((completed / total) * 100) : 0;

  await Project.findByIdAndUpdate(project._id, {
    totalStories: total,
    completedStories: completed,
    inProgressStories: inProgress,
    completionPercentage,
    status: 'active',
    updatedAt: new Date(),
  });

  const epics = await Epic.find({ project: project._id });
  for (const epic of epics) {
    const epicStories = await Story.find({ epic: epic._id, type: { $in: ['story', 'task', 'subtask', 'bug'] } }).lean();
    const epicTotal = epicStories.length;
    const epicDone = epicStories.filter((s) => s.status === 'done').length;
    await Epic.findByIdAndUpdate(epic._id, {
      totalStories: epicTotal,
      completedStories: epicDone,
      completionPercentage: epicTotal ? Math.round((epicDone / epicTotal) * 100) : 0,
    });
  }
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const targetEmail = getArgValue('email', 'aghule005@gmail.com').trim().toLowerCase();
  const projectKey = (getArgValue('projectKey', 'HOS') || 'HOS').toUpperCase();
  const projectName = getArgValue('projectName', 'Hospital Management') || 'Hospital Management';

  const user = await User.findOne({ email: targetEmail }).lean();
  if (!user) {
    throw new Error(`User not found for email ${targetEmail}`);
  }

  const project = await ensureProject(user, projectKey, projectName);

  await Project.findByIdAndUpdate(project._id, {
    jiraConnected: true,
    jiraProjectKey: process.env.SEED_JIRA_KEY || 'DMS1',
  });

  await seedSprints(project._id);
  await seedDocsAndRequirements(user._id, project._id);
  await seedBacklog(user._id, project);
  await seedCommits(project._id);
  await recomputeMetrics(project);

  const [projectDoc, epicCount, storyCount, commitCount, sprintCount, docCount] = await Promise.all([
    Project.findById(project._id).select('name key status completionPercentage totalStories completedStories jiraConnected jiraProjectKey').lean(),
    Epic.countDocuments({ project: project._id }),
    Story.countDocuments({ project: project._id }),
    Commit.countDocuments({ projectId: project._id }),
    Sprint.countDocuments({ project: project._id }),
    Document.countDocuments({ project: project._id }),
  ]);

  console.log(JSON.stringify({
    success: true,
    seededFor: { email: targetEmail, userId: String(user._id) },
    project: projectDoc,
    counts: {
      epics: epicCount,
      stories: storyCount,
      commits: commitCount,
      sprints: sprintCount,
      documents: docCount,
    },
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(JSON.stringify({ success: false, message: error.message }, null, 2));
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
