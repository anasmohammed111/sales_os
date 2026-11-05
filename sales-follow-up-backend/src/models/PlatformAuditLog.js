const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const PLATFORM_ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'VIEW_WORKSPACE', 'FEATURE_CHANGED'];

// What super admins did. Visible in the platform console only, never to workspaces.
const platformAuditLogSchema = new mongoose.Schema(
    {
        platformAdminId: { type: ObjectId, ref: 'PlatformAdmin', default: null },
        action: { type: String, enum: PLATFORM_ACTIONS, required: true },
        businessId: { type: ObjectId, ref: 'Business', default: null },
        reason: { type: String, trim: true, default: '', maxlength: 500 },
        details: { type: mongoose.Schema.Types.Mixed, default: {} },
        ip: { type: String, default: '' },
        userAgent: { type: String, default: '', maxlength: 300 },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

platformAuditLogSchema.index({ createdAt: -1 });
platformAuditLogSchema.index({ businessId: 1, createdAt: -1 });

module.exports = mongoose.model('PlatformAuditLog', platformAuditLogSchema);
module.exports.PLATFORM_ACTIONS = PLATFORM_ACTIONS;
