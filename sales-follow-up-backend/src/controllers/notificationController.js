const mongoose = require('mongoose');
const Notification = require('../models/Notification');

const mine = (req) => ({ businessId: req.user.businessId, userId: req.user.userId });

const serialize = (n) => ({
    id: n._id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    applicationId: n.applicationId,
    isRead: n.isRead,
    createdAt: n.createdAt,
});

const listNotifications = async (req, res, next) => {
    try {
        const filter = mine(req);
        if (req.query.unreadOnly === 'true') filter.isRead = false;
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);

        const [items, unreadCount] = await Promise.all([
            Notification.find(filter).sort({ createdAt: -1 }).limit(limit),
            Notification.countDocuments({ ...mine(req), isRead: false }),
        ]);

        return res.json({ success: true, data: { items: items.map(serialize), unreadCount } });
    } catch (error) {
        next(error);
    }
};

const unreadCount = async (req, res, next) => {
    try {
        const count = await Notification.countDocuments({ ...mine(req), isRead: false });
        return res.json({ success: true, data: { count } });
    } catch (error) {
        next(error);
    }
};

const markRead = async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }
        const notification = await Notification.findOneAndUpdate(
            { ...mine(req), _id: req.params.id },
            { $set: { isRead: true, readAt: new Date() } },
            { new: true }
        );
        if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
        return res.json({ success: true, data: serialize(notification) });
    } catch (error) {
        next(error);
    }
};

const markAllRead = async (req, res, next) => {
    try {
        await Notification.updateMany({ ...mine(req), isRead: false }, { $set: { isRead: true, readAt: new Date() } });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

module.exports = { listNotifications, unreadCount, markRead, markAllRead };
