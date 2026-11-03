const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const REMINDER_KINDS = ['FOLLOW_UP', 'INTERVIEW', 'EXAM', 'VISA_APPOINTMENT', 'PAYMENT_DUE', 'DOCUMENT_EXPIRY'];

// A scheduled in-app reminder. Rows persist, so reminders missed while the
// server slept are sent on the next run.
const reminderSchema = new mongoose.Schema(
    {
        businessId: { type: ObjectId, ref: 'Business', required: true },
        applicationId: { type: ObjectId, ref: 'AdmissionApplication', required: true },
        userId: { type: ObjectId, ref: 'User', required: true },
        kind: { type: String, enum: REMINDER_KINDS, required: true },
        sourceId: { type: ObjectId, required: true },
        eventAt: { type: Date, required: true },
        remindAt: { type: Date, required: true },
        status: { type: String, enum: ['SCHEDULED', 'SENT', 'CANCELLED'], default: 'SCHEDULED' },
        sentAt: { type: Date, default: null },
        // kind:sourceId:eventAt:userId — the same reminder can never be scheduled twice
        dedupeKey: { type: String, required: true, unique: true },
    },
    { timestamps: true }
);

reminderSchema.index({ status: 1, remindAt: 1 });
reminderSchema.index({ sourceId: 1, status: 1 });

module.exports = mongoose.model('Reminder', reminderSchema);
module.exports.REMINDER_KINDS = REMINDER_KINDS;
