const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/access');

const {
    createFollowUp,
    getFollowUps,
    updateFollowUp,
    archiveFollowUp,
    deleteFollowUp,
} = require('../controllers/followUpController');

router.use(authMiddleware);

router.post('/', requirePermission('followups.create'), createFollowUp);
router.get('/', requirePermission('followups.view'), getFollowUps);
router.patch('/:id', requirePermission('followups.edit'), updateFollowUp);
router.patch('/:id/archive', requirePermission('followups.archive'), archiveFollowUp);
router.delete('/:id', requirePermission('followups.delete'), deleteFollowUp);

module.exports = router;
