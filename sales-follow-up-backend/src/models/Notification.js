const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

// In-app notification for one user. `channel` leaves room for email/WhatsApp later.
const notificationSchema = new mongoose.Schema(
    {
        businessId: { type: ObjectId, ref: 'Business', required: true },
        userId: { type: ObjectId, ref: 'User', required: true },
        applicationId: { type: ObjectId, ref: 'AdmissionApplication', default: null },
        type: { type: String, required: true },
        channel: { type: String, enum: ['IN_APP'], default: 'IN_APP' },
        title: { type: String, required: true, trim: true, maxlength: 200 },
        body: { type: String, trim: true, default: '', maxlength: 1000 },
        // Frontend route, e.g. /admissions/students/<id>
        link: { type: String, default: '' },
        isRead: { type: Boolean, default: false },
        readAt: { type: Date, default: null },
        // Unique per logical event, so retries never notify twice
        dedupeKey: { type: String, required: true, unique: true },
    },
    { timestamps: true }
);

notificationSchema.index({ businessId: 1, userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
