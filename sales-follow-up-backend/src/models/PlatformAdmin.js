const mongoose = require('mongoose');

// A platform super admin: sees every workspace. Not a workspace user, never
// listed in any team, and created only with scripts/create-super-admin.js.
const platformAdminSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 100 },
        email: { type: String, required: true, lowercase: true, trim: true, unique: true },
        password: { type: String, required: true, select: false },
        isActive: { type: Boolean, default: true },
        lastLoginAt: { type: Date, default: null },
        // Lockout after repeated wrong passwords
        failedLogins: { type: Number, default: 0 },
        lockedUntil: { type: Date, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('PlatformAdmin', platformAdminSchema);
