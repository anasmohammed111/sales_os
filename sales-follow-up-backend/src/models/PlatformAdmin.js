const mongoose = require('mongoose');
const { ROLE_KEYS } = require('../services/platform/roles');

// A Kelto platform administrator: works across every workspace. Not a
// workspace user, never listed in any team. The first one is created with
// scripts/create-super-admin.js; super admins add the rest in the admin app.
const platformAdminSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 100 },
        email: { type: String, required: true, lowercase: true, trim: true, unique: true },
        password: { type: String, required: true, select: false },
        // Missing on accounts created before roles: treated as SUPER_ADMIN (roles.js#roleOf)
        role: { type: String, enum: ROLE_KEYS },
        isActive: { type: Boolean, default: true },
        // Bumped to sign the administrator out everywhere (revoke sessions)
        tokenVersion: { type: Number, default: 0 },
        // Set when someone else chose the password: it must be changed at sign-in
        mustChangePassword: { type: Boolean, default: false },
        passwordChangedAt: { type: Date, default: null },
        lastLoginAt: { type: Date, default: null },
        // Lockout after repeated wrong passwords
        failedLogins: { type: Number, default: 0 },
        lockedUntil: { type: Date, default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin', default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('PlatformAdmin', platformAdminSchema);
