const express = require('express');
const { protect } = require('../middleware/auth');
const { generateInsightsController, generateGlobalInsightsController } = require('../controllers/insightController');

const router = express.Router();

router.use(protect);
router.get('/global', generateGlobalInsightsController);
router.get('/:projectId', generateInsightsController);

module.exports = router;
