const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const notifications = require('../controllers/notificationController');

const router = express.Router();

router.use(authMiddleware);

router.get('/', notifications.listNotifications);
router.get('/unread-count', notifications.unreadCount);
router.patch('/read-all', notifications.markAllRead);
router.patch('/:id/read', notifications.markRead);

module.exports = router;
