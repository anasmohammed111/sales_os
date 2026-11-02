const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const { createTeamMember, getTeamMembers, updateTeamMember, deactivateTeamMember, deleteTeamMember } = require('../controllers/teamController');

router.post('/', authMiddleware, createTeamMember);
router.get('/', authMiddleware, getTeamMembers);
router.patch('/:id', authMiddleware, updateTeamMember);
router.patch('/:id/deactivate', authMiddleware, deactivateTeamMember);
router.delete('/:id', authMiddleware, deleteTeamMember);

module.exports = router;