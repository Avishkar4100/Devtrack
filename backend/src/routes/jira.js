const express = require('express');
const router = express.Router();
const {
	testConnection,
	getJiraProjects,
	connectProject,
	pushToJira,
	listServerProjects,
	createServerProject,
	updateServerProject,
	deleteServerProject,
	listServerProjectMembers,
	getServerProjectActiveSprint,
	listServerIssues,
	getServerIssue,
	createServerIssue,
	updateServerIssue,
	deleteServerIssue,
	listServerIssueTransitions,
	transitionServerIssue,
	assignServerIssueToMe,
	createServerIssueComment,
	updateServerIssueComment,
	deleteServerIssueComment,
	createServerIssueSubtask,
	deleteServerIssueSubtask,
	createServerIssueLink,
	deleteServerIssueLink,
	jiraProxy,
	syncFromJira,
	getJiraAISummary,
} = require('../controllers/jiraController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.get('/test', testConnection);
router.get('/projects', getJiraProjects);
router.post('/connect/:projectId', connectProject);
router.post('/push/:projectId', authorize('manager', 'scrum_master'), pushToJira);
router.post('/sync/:projectId', syncFromJira);

// Full Jira server control
router.get('/server/projects', listServerProjects);
router.get('/server/projects/:projectIdOrKey/members', listServerProjectMembers);
router.get('/server/projects/:projectIdOrKey/active-sprint', getServerProjectActiveSprint);
router.post('/server/projects', createServerProject);
router.put('/server/projects/:projectIdOrKey', updateServerProject);
router.patch('/server/projects/:projectIdOrKey', updateServerProject);
router.delete('/server/projects/:projectIdOrKey', deleteServerProject);

router.get('/server/issues', listServerIssues);
router.get('/server/issues/summary/:projectKey', getJiraAISummary);
router.get('/server/issues/:issueKey', getServerIssue);
router.post('/server/issues', createServerIssue);
router.put('/server/issues/:issueKey', updateServerIssue);
router.patch('/server/issues/:issueKey', updateServerIssue);
router.delete('/server/issues/:issueKey', deleteServerIssue);
router.get('/server/issues/:issueKey/transitions', listServerIssueTransitions);
router.post('/server/issues/:issueKey/transitions', transitionServerIssue);
router.post('/server/issues/:issueKey/assign-me', assignServerIssueToMe);
router.post('/server/issues/:issueKey/comments', createServerIssueComment);
router.put('/server/issues/:issueKey/comments/:commentId', updateServerIssueComment);
router.patch('/server/issues/:issueKey/comments/:commentId', updateServerIssueComment);
router.delete('/server/issues/:issueKey/comments/:commentId', deleteServerIssueComment);
router.post('/server/issues/:issueKey/subtasks', createServerIssueSubtask);
router.delete('/server/issues/:issueKey/subtasks/:subtaskKey', deleteServerIssueSubtask);
router.post('/server/issues/:issueKey/links', createServerIssueLink);
router.delete('/server/issue-links/:linkId', deleteServerIssueLink);

router.post('/server/proxy', jiraProxy);

module.exports = router;
