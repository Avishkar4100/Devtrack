const express = require('express');
const router = express.Router();
const {
  getSprints,
  createSprint,
  updateSprint,
  deleteSprint,
  closeSprint,
  getSprintSummary,
  getUpcomingClosures,
} = require('../controllers/sprintController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/project/:projectId', getSprints);
router.post('/project/:projectId', createSprint);
router.get('/project/:projectId/upcoming', getUpcomingClosures);
router.get('/:id/summary', getSprintSummary);
router.route('/:id').put(updateSprint).delete(deleteSprint);
router.post('/:id/close', closeSprint);

module.exports = router;
