const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const SUPPORT_MODES = ['VIEW_OWNER', 'VIEW_USER', 'SUPPORT_EDIT'];
const SUPPORT_STATUSES = ['ACTIVE', 'ENDED', 'REVOKED'];

// A Kelto administrator's visit to one workspace. Checked on every request,
// so ending or revoking it takes effect immediately.
//   VIEW_OWNER   read-only, sees what the workspace owner sees
//   VIEW_USER    read-only, sees exactly what one person sees (role, scope, menus)
//   SUPPORT_EDIT may change a limited set of things, only while the owner allows it
const supportSessionSchema = new mongoose.Schema(
    {
        platformAdminId: { type: ObjectId, ref: 'PlatformAdmin', required: true },
        businessId: { type: ObjectId, ref: 'Business', required: true },
        mode: { type: String, enum: SUPPORT_MODES, required: true },
        // The person whose view is reproduced (owner for VIEW_OWNER); null for SUPPORT_EDIT
        targetUserId: { type: ObjectId, ref: 'User', default: null },
        reason: { type: String, trim: true, required: true, maxlength: 500 },
        // SUPPORT_EDIT only: workspace permission keys the session may use to change things
        allowedPermissions: [{ type: String }],
        landingPath: { type: String, default: '/dashboard', maxlength: 200 },
        status: { type: String, enum: SUPPORT_STATUSES, default: 'ACTIVE' },
        expiresAt: { type: Date, required: true },
        startedAt: { type: Date, default: Date.now },
        endedAt: { type: Date, default: null },
        endedBy: {
            kind: { type: String, enum: ['ADMIN', 'OWNER', 'SYSTEM', null], default: null },
            id: { type: ObjectId, default: null },
        },
        endReason: { type: String, trim: true, default: '', maxlength: 500 },
        // Single-use code the admin app hands to the CRM; only its hash is stored
        handoffCodeHash: { type: String, default: null },
        handoffExpiresAt: { type: Date, default: null },
        handoffUsedAt: { type: Date, default: null },
        writeCount: { type: Number, default: 0 },
        ip: { type: String, default: '' },
        userAgent: { type: String, default: '', maxlength: 300 },
    },
    { timestamps: true }
);

supportSessionSchema.index({ platformAdminId: 1, status: 1 });
supportSessionSchema.index({ businessId: 1, status: 1, createdAt: -1 });
supportSessionSchema.index({ status: 1, createdAt: -1 });
supportSessionSchema.index({ handoffCodeHash: 1 }, { unique: true, partialFilterExpression: { handoffCodeHash: { $type: 'string' } } });

/** Whether the session can still be used right now. */
supportSessionSchema.methods.isLive = function isLive(now = new Date()) {
    return this.status === 'ACTIVE' && this.expiresAt > now;
};

module.exports = mongoose.model('SupportSession', supportSessionSchema);
module.exports.SUPPORT_MODES = SUPPORT_MODES;
module.exports.SUPPORT_STATUSES = SUPPORT_STATUSES;
