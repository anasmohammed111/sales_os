const jwt = require('jsonwebtoken');
const PlatformAdmin = require('../models/PlatformAdmin');
const { bearer, verifyConsoleToken, SUPPORT_BLOCKED_WRITES } = require('../services/platform');
const { roleOf, permissionsOf } = require('../services/platform/roles');

const deny = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code && { code }) });

// Reachable while a temporary password still has to be changed
const PASSWORD_CHANGE_PATHS = new Set(['/auth/me', '/auth/change-password']);

/**
 * Admin app only: accepts console tokens, nothing else. The account is
 * re-read on every request, so deactivating it, changing its role or revoking
 * its sessions (tokenVersion) takes effect immediately.
 */
const requirePlatformAdmin = async (req, res, next) => {
    const token = bearer(req);
    if (!token) return deny(res, 401, 'Sign in to the Kelto admin app');

    let claims;
    try {
        claims = verifyConsoleToken(token);
    } catch {
        return deny(res, 401, 'Your session has ended. Sign in again.');
    }
    if (claims.kind !== 'platform' || !claims.platformAdminId) return deny(res, 401, 'Sign in to the Kelto admin app');

    try {
        const admin = await PlatformAdmin.findById(claims.platformAdminId).select('name email role isActive tokenVersion mustChangePassword');
        if (!admin || !admin.isActive) return deny(res, 401, 'This administrator account is not active');
        if ((claims.ver || 0) !== (admin.tokenVersion || 0)) return deny(res, 401, 'Your session was ended. Sign in again.');

        req.platformAdmin = {
            id: String(admin._id),
            name: admin.name,
            email: admin.email,
            role: roleOf(admin),
            permissions: new Set(permissionsOf(admin)),
            mustChangePassword: admin.mustChangePassword === true,
        };
        if (req.platformAdmin.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(req.path)) {
            return deny(res, 403, 'Change your temporary password first', 'PASSWORD_CHANGE_REQUIRED');
        }
        return next();
    } catch (error) {
        return next(error);
    }
};

/** Route guard: the administrator's role must include every listed permission. */
const requirePlatformPermission =
    (...keys) =>
    (req, res, next) => {
        const missing = keys.filter((key) => !req.platformAdmin?.permissions.has(key));
        if (missing.length) return deny(res, 403, 'Your administrator role does not allow this', 'PLATFORM_PERMISSION_DENIED');
        return next();
    };

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Mounted before every API route. Support sessions: read-only modes never
 * write; no support session may touch sign-in, account settings, people,
 * roles or the platform API, whatever its permissions. Decoding is enough
 * here because it only ever refuses; authMiddleware verifies the token.
 */
const supportSessionGuard = (req, res, next) => {
    if (READ_METHODS.has(req.method)) return next();
    const token = bearer(req);
    const claims = token ? jwt.decode(token) : null;
    if (claims?.kind !== 'support') return next();
    // Ending your own session is always allowed
    if (req.originalUrl.split('?')[0] === '/api/support/end') return next();

    if (claims.mode !== 'SUPPORT_EDIT') {
        return deny(res, 403, 'This Kelto support session is read-only', 'READ_ONLY');
    }
    const path = req.originalUrl.split('?')[0];
    if (SUPPORT_BLOCKED_WRITES.some((pattern) => pattern.test(path))) {
        return deny(res, 403, 'Support sessions cannot change sign-in, account, people or role settings', 'SUPPORT_NOT_ALLOWED');
    }
    return next();
};

module.exports = { requirePlatformAdmin, requirePlatformPermission, supportSessionGuard, READ_METHODS };
