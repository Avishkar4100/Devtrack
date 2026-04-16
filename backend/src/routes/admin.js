const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getAdminOverview,
  getAIConfig,
  updateAIConfig,
  createAIConfig,
  updateAIConfigById,
  activateAIConfig,
  deleteAIConfig,
  testAIConfig,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} = require('../controllers/adminController');

router.use(protect, authorize('admin'));

router.get('/overview', getAdminOverview);
router.get('/ai-config', getAIConfig);
router.post('/ai-config', createAIConfig);
router.put('/ai-config', updateAIConfig);
router.put('/ai-config/:id', updateAIConfigById);
router.put('/ai-config/:id/activate', activateAIConfig);
router.delete('/ai-config/:id', deleteAIConfig);
router.post('/ai-config/test', testAIConfig);

router.get('/users', listUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

module.exports = router;
