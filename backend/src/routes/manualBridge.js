const express = require('express');
const { protect } = require('../middleware/auth');
const {
  listRequests,
  getStats,
  resolveRequest,
  rejectRequest,
} = require('../controllers/manualBridgeController');

const router = express.Router();

router.use(protect);
router.get('/requests', listRequests);
router.get('/stats', getStats);
router.post('/requests/:requestId/resolve', resolveRequest);
router.post('/requests/:requestId/reject', rejectRequest);

module.exports = router;
