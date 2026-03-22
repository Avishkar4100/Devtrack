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
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} = require('../controllers/adminController');

router.use(protect, authorize('admin'));

router.get('/overview', getAdminOverview);
router.get('/ai-config', getAIConfig);
router.post('/ai-config', createAIConfig);
router.put('/ai-config', updateAIConfig);
router.put('/ai-config/:id', updateAIConfigById);
router.put('/ai-config/:id/activate', activateAIConfig);
router.delete('/ai-config/:id', deleteAIConfig);

router.get('/users', listUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

router.get('/organizations', listOrganizations);
router.post('/organizations', createOrganization);
router.put('/organizations/:id', updateOrganization);
router.delete('/organizations/:id', deleteOrganization);

router.get('/projects', listProjects);
router.post('/projects', createProject);
router.put('/projects/:id', updateProject);
router.delete('/projects/:id', deleteProject);

module.exports = router;
