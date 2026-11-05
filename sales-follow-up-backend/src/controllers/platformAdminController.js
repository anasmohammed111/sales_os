// Kelto platform administrators: list, add, change role, deactivate, reset
// access, revoke sessions, sign-in history. Temporary passwords are shown once
// and must be changed at the next sign-in. No invitation emails.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const PlatformAdmin = require('../models/PlatformAdmin');
const PlatformAuditLog = require('../models/PlatformAuditLog');
const { audit } = require('../services/platform');
const { ROLE_KEYS, PLATFORM_ROLES, PLATFORM_PERMISSIONS, roleOf } = require('../services/platform/roles');
const { endSessions } = require('./platformController');

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const temporaryPassword = () => crypto.randomBytes(15).toString('base64url');

const describe = (a) => ({
    id: String(a._id),
    name: a.name,
    email: a.email,
    role: roleOf(a),
    roleName: PLATFORM_ROLES[roleOf(a)].name,
    isActive: a.isActive !== false,
    mustChangePassword: a.mustChangePassword === true,
    lastLoginAt: a.lastLoginAt,
    lockedUntil: a.lockedUntil && a.lockedUntil > new Date() ? a.lockedUntil : null,
    createdAt: a.createdAt,
});

/** Roles and what each allows, for the admin app's role picker. */
const listRoles = (req, res) =>
    res.json({
        success: true,
        data: {
            roles: ROLE_KEYS.map((key) => ({ key, name: PLATFORM_ROLES[key].name, permissions: PLATFORM_ROLES[key].permissions })),
            permissions: PLATFORM_PERMISSIONS,
        },
    });

const listAdmins = async (req, res, next) => {
    try {
        const admins = await PlatformAdmin.find().sort({ createdAt: 1 });
        return res.json({ success: true, data: { items: admins.map(describe) } });
    } catch (error) {
        next(error);
    }
};

const findAdmin = (id) => (mongoose.isValidObjectId(id) ? PlatformAdmin.findById(id) : null);

/** True when `admin` is the only active super admin left. */
const isLastSuperAdmin = async (admin) =>
    roleOf(admin) === 'SUPER_ADMIN' &&
    admin.isActive !== false &&
    (await PlatformAdmin.countDocuments({
        _id: { $ne: admin._id },
        isActive: { $ne: false },
        $or: [{ role: 'SUPER_ADMIN' }, { role: { $exists: false } }, { role: null }],
    })) === 0;

const createAdmin = async (req, res, next) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const role = req.body?.role;
        if (!name) return fail(res, 400, 'Enter a name');
        if (!EMAIL.test(email)) return fail(res, 400, 'Enter a valid email (used to sign in)');
        if (!ROLE_KEYS.includes(role)) return fail(res, 400, 'Choose a role');
        if (await PlatformAdmin.exists({ email })) return fail(res, 409, 'An administrator with that email already exists');

        const password = temporaryPassword();
        const admin = await PlatformAdmin.create({
            name,
            email,
            role,
            password: await bcrypt.hash(password, 12),
            mustChangePassword: true,
            createdBy: req.platformAdmin.id,
        });
        await audit(req, { platformAdminId: req.platformAdmin.id, action: 'ADMIN_CREATED', targetAdminId: admin._id, details: { email, role } });
        return res.status(201).json({ success: true, data: { admin: describe(admin), temporaryPassword: password } });
    } catch (error) {
        if (error.code === 11000) return fail(res, 409, 'An administrator with that email already exists');
        next(error);
    }
};

/** Change name, role or active state. Role and active changes sign the person out everywhere. */
const updateAdmin = async (req, res, next) => {
    try {
        const admin = await findAdmin(req.params.id);
        if (!admin) return fail(res, 404, 'Administrator not found');
        const self = String(admin._id) === req.platformAdmin.id;
        const body = req.body || {};
        const changes = {};

        if (typeof body.name === 'string' && body.name.trim()) changes.name = body.name.trim().slice(0, 100);
        if (body.role !== undefined && body.role !== roleOf(admin)) {
            if (!ROLE_KEYS.includes(body.role)) return fail(res, 400, 'Choose a role');
            if (self) return fail(res, 403, "You can't change your own role");
            if (await isLastSuperAdmin(admin)) return fail(res, 409, 'Keep at least one active super admin');
            changes.role = body.role;
        }
        if (body.isActive !== undefined && body.isActive !== (admin.isActive !== false)) {
            if (typeof body.isActive !== 'boolean') return fail(res, 400, 'isActive must be true or false');
            if (self) return fail(res, 403, "You can't deactivate yourself");
            if (!body.isActive && (await isLastSuperAdmin(admin))) return fail(res, 409, 'Keep at least one active super admin');
            changes.isActive = body.isActive;
        }
        if (!Object.keys(changes).length) return res.json({ success: true, data: { admin: describe(admin) } });

        const before = { name: admin.name, role: roleOf(admin), isActive: admin.isActive !== false };
        admin.set(changes);
        if (changes.role || changes.isActive === false) {
            admin.tokenVersion = (admin.tokenVersion || 0) + 1;
            await endSessions({ platformAdminId: admin._id }, { kind: 'ADMIN', id: req.platformAdmin.id, reason: 'Administrator access changed' });
        }
        await admin.save();
        await audit(req, {
            platformAdminId: req.platformAdmin.id,
            action: 'ADMIN_UPDATED',
            targetAdminId: admin._id,
            details: { before, after: { name: admin.name, role: roleOf(admin), isActive: admin.isActive !== false } },
        });
        return res.json({ success: true, data: { admin: describe(admin) } });
    } catch (error) {
        next(error);
    }
};

/** A new temporary password (shown once); signs the person out and unlocks the account. */
const resetPassword = async (req, res, next) => {
    try {
        const admin = await findAdmin(req.params.id);
        if (!admin) return fail(res, 404, 'Administrator not found');
        if (String(admin._id) === req.platformAdmin.id) return fail(res, 403, 'Change your own password from your account menu');

        const password = temporaryPassword();
        admin.set({
            password: await bcrypt.hash(password, 12),
            mustChangePassword: true,
            failedLogins: 0,
            lockedUntil: null,
            tokenVersion: (admin.tokenVersion || 0) + 1,
        });
        await admin.save();
        await endSessions({ platformAdminId: admin._id }, { kind: 'ADMIN', id: req.platformAdmin.id, reason: 'Password reset' });
        await audit(req, { platformAdminId: req.platformAdmin.id, action: 'ADMIN_PASSWORD_RESET', targetAdminId: admin._id });
        return res.json({ success: true, data: { admin: describe(admin), temporaryPassword: password } });
    } catch (error) {
        next(error);
    }
};

/** Signs the administrator out of every device and ends their support sessions. */
const revokeSessions = async (req, res, next) => {
    try {
        const admin = await findAdmin(req.params.id);
        if (!admin) return fail(res, 404, 'Administrator not found');
        const self = String(admin._id) === req.platformAdmin.id;
        if (!self && !req.platformAdmin.permissions.has('admins.manage')) {
            return fail(res, 403, 'Your administrator role does not allow this', { code: 'PLATFORM_PERMISSION_DENIED' });
        }
        admin.tokenVersion = (admin.tokenVersion || 0) + 1;
        await admin.save();
        const ended = await endSessions({ platformAdminId: admin._id }, { kind: 'ADMIN', id: req.platformAdmin.id, reason: 'Sessions revoked' });
        await audit(req, {
            platformAdminId: req.platformAdmin.id,
            action: 'ADMIN_SESSIONS_REVOKED',
            targetAdminId: admin._id,
            details: { supportSessionsEnded: ended.modifiedCount },
        });
        return res.json({ success: true, data: { admin: describe(admin) } });
    } catch (error) {
        next(error);
    }
};

const loginHistory = async (req, res, next) => {
    try {
        const admin = await findAdmin(req.params.id);
        if (!admin) return fail(res, 404, 'Administrator not found');
        const entries = await PlatformAuditLog.find({ platformAdminId: admin._id, action: { $in: ['LOGIN', 'LOGIN_FAILED', 'PASSWORD_CHANGED'] } })
            .sort({ createdAt: -1 })
            .limit(100);
        return res.json({
            success: true,
            data: { items: entries.map((e) => ({ id: e._id, action: e.action, details: e.details, ip: e.ip, userAgent: e.userAgent, createdAt: e.createdAt })) },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { listRoles, listAdmins, createAdmin, updateAdmin, resetPassword, revokeSessions, loginHistory };
