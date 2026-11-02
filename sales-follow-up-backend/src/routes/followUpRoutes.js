const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');

const {
    createFollowUp,
    getFollowUps,
    updateFollowUp,
    archiveFollowUp,
    deleteFollowUp,
} = require('../controllers/followUpController');

router.use(authMiddleware);

router.post('/', createFollowUp);
router.get('/', getFollowUps);
router.patch('/:id', updateFollowUp);
router.patch('/:id/archive', archiveFollowUp);
router.delete('/:id', deleteFollowUp);

module.exports = router;
