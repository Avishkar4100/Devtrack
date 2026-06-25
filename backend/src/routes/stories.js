const express = require('express');
const router = express.Router();
const {
  getStoriesByProject, getEpics, getProjectState, generateStories, saveGeneratedStories,
  createStory, updateStory, deleteStory, suggestStories, bulkAssignStories, previewGenerateStories,
  getBacklogHistory,
} = require('../controllers/storyController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.get('/project/:projectId', getStoriesByProject);
router.get('/epics/:projectId', getEpics);
router.get('/project-state/:projectId', authorize('manager', 'scrum_master', 'admin'), getProjectState);
router.get('/backlog-history/:projectId', authorize('manager', 'scrum_master', 'admin'), getBacklogHistory);
router.post('/generate/:projectId', authorize('manager', 'scrum_master', 'admin'), generateStories);
router.post('/generate-preview/:projectId', authorize('manager', 'scrum_master', 'admin'), previewGenerateStories);
router.post('/suggest/:projectId', authorize('manager', 'scrum_master', 'admin'), suggestStories);
router.post('/save/:projectId', authorize('manager', 'scrum_master', 'admin'), saveGeneratedStories);
router.post('/bulk-assign', authorize('manager', 'scrum_master', 'admin'), bulkAssignStories);
router.post('/', createStory);
router.route('/:id').put(updateStory).delete(deleteStory);

module.exports = router;
