const express = require('express');
const router = express.Router();
const {
  connectRepo,
  getCommits,
  triggerAnalysis,
  handleWebhook,
  validateToken,
  validateRepo,
  validateBranch,
  getRateLimit,
  getRepositories,
  validateConnection,
  getHealth,
} = require('../controllers/githubController');
const { protect } = require('../middleware/auth');

router.post('/webhook/:projectId', handleWebhook); // Public - webhook
router.use(protect);

// Validation endpoints
router.post('/validate-token', validateToken);
router.post('/validate-repo', validateRepo);
router.post('/validate-branch', validateBranch);
router.post('/validate-connection', validateConnection);
router.get('/rate-limit', getRateLimit);
router.get('/repositories', getRepositories);
router.get('/health', getHealth);

// Original endpoints
router.post('/connect/:projectId', connectRepo);
router.get('/commits/:projectId', getCommits);
router.post('/analyze/:projectId', triggerAnalysis);

module.exports = router;
