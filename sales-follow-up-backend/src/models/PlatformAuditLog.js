const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const PLATFORM_ACTIONS = [
    'LOGIN',
    'LOGIN_FAILED',
    'PASSWORD_CHANGED',
    // Kept for entries written before support sessions existed
    'VIEW_WORKSPACE',
    'FEATURE_CHANGED',
    'COMPANY_SUSPENDED',
    'COMPANY_REACTIVATED',
    'SUPPORT_SESSION_STARTED',
    'SUPPORT_SESSION_ENDED',
    'SUPPORT_SESSION_REVOKED',
    'SUPPORT_ACTION',
    'SUPPORT_ACCESS_CHANGED',
    'ADMIN_CREATED',
    'ADMIN_UPDATED',
    'ADMIN_PASSWORD_RESET',
    'ADMIN_SESSIONS_REVOKED',
    'PLAN_CREATED',
    'PLAN_UPDATED',
    'SUBSCRIPTION_CREATED',
    'SUBSCRIPTION_UPDATED',
];

// What Kelto staff did. Visible in the admin app only, never to workspaces.
// The actor is always the real platform administrator (or null for a failed
// sign-in, or a workspace owner changing support access: see details).
const platformAuditLogSchema = new mongoose.Schema(
    {
        platformAdminId: { type: ObjectId, ref: 'PlatformAdmin', default: null },
        action: { type: String, enum: PLATFORM_ACTIONS, required: true },
        businessId: { type: ObjectId, ref: 'Business', default: null },
        supportSessionId: { type: ObjectId, ref: 'SupportSession', default: null },
        targetAdminId: { type: ObjectId, ref: 'PlatformAdmin', default: null },
        reason: { type: String, trim: true, default: '', maxlength: 500 },
        details: { type: mongoose.Schema.Types.Mixed, default: {} },
        ip: { type: String, default: '' },
        userAgent: { type: String, default: '', maxlength: 300 },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

platformAuditLogSchema.index({ createdAt: -1 });
platformAuditLogSchema.index({ businessId: 1, createdAt: -1 });
platformAuditLogSchema.index({ platformAdminId: 1, action: 1, createdAt: -1 });
platformAuditLogSchema.index({ supportSessionId: 1, createdAt: -1 });

module.exports = mongoose.model('PlatformAuditLog', platformAuditLogSchema);
module.exports.PLATFORM_ACTIONS = PLATFORM_ACTIONS;
