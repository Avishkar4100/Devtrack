const express = require('express');
const router = express.Router();
const { getDashboard, getOverview, getOverviewSummary, getControlTower } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/overview', getOverview);
router.get('/overview-summary', getOverviewSummary);
router.get('/:projectId/control-tower', getControlTower);
router.get('/:projectId', getDashboard);

module.exports = router;
