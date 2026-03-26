const express = require('express');
const router = express.Router();
const {
  getStoriesByProject, getEpics, generateStories, saveGeneratedStories,
  createStory, updateStory, deleteStory, suggestStories,
} = require('../controllers/storyController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.get('/project/:projectId', getStoriesByProject);
router.get('/epics/:projectId', getEpics);
router.post('/generate/:projectId', authorize('manager', 'scrum_master', 'admin'), generateStories);
router.post('/suggest/:projectId', authorize('manager', 'scrum_master', 'admin'), suggestStories);
router.post('/save/:projectId', authorize('manager', 'scrum_master', 'admin'), saveGeneratedStories);
router.post('/', createStory);
router.route('/:id').put(updateStory).delete(deleteStory);

module.exports = router;
