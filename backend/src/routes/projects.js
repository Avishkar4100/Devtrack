const express = require('express');
const router = express.Router();
const {
  getProjects, getProject, createProject, updateProject, deleteProject,
  inviteMember, removeMember, getAuditLog, getProjectUsers,
} = require('../controllers/projectController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.route('/').get(getProjects).post(createProject);
router.route('/:id').get(getProject).put(updateProject).delete(deleteProject);
router.post('/:id/invite', inviteMember);
router.delete('/:id/members/:userId', removeMember);
router.get('/:id/audit', getAuditLog);
router.get('/:id/users', getProjectUsers);

module.exports = router;
