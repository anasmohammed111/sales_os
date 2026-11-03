const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

// One timeline per application: notes plus every tracked change.
const ACTIVITY_TYPES = [
    'APPLICATION_CREATED',
    'DETAILS_UPDATED',
    'ASSIGNED',
    'STATUS_CHANGED',
    'STAGE_MOVED',
    'CHECKLIST_UPDATED',
    'ASSESSMENT_UPDATED',
    'VISA_UPDATED',
    'DOCUMENT_ADDED',
    'DOCUMENT_UPLOADED',
    'DOCUMENT_REVIEWED',
    'FEE_ADDED',
    'FEE_UPDATED',
    'PAYMENT_RECORDED',
    'PAYMENT_VOIDED',
    'TASK_CREATED',
    'TASK_UPDATED',
    'NOTE',
];

const admissionActivitySchema = new mongoose.Schema(
    {
        businessId: { type: ObjectId, ref: 'Business', required: true },
        applicationId: { type: ObjectId, ref: 'AdmissionApplication', required: true },
        actorId: { type: ObjectId, ref: 'User', default: null },
        type: { type: String, enum: ACTIVITY_TYPES, required: true },
        message: { type: String, trim: true, default: '', maxlength: 500 },
        // Note text (type NOTE only)
        body: { type: String, trim: true, default: '', maxlength: 5000 },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

admissionActivitySchema.index({ businessId: 1, applicationId: 1, createdAt: -1 });

module.exports = mongoose.model('AdmissionActivity', admissionActivitySchema);
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
