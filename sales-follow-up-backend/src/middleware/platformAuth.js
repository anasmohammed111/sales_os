const jwt = require('jsonwebtoken');
const PlatformAdmin = require('../models/PlatformAdmin');
const { bearer, verifyConsoleToken } = require('../services/platform');

const deny = (res, status, message) => res.status(status).json({ success: false, message });

/**
 * Platform console only: accepts console tokens, nothing else. The account is
 * re-read on every request, so deactivating it takes effect immediately.
 */
const requirePlatformAdmin = async (req, res, next) => {
    const token = bearer(req);
    if (!token) return deny(res, 401, 'Sign in as super admin');

    let claims;
    try {
        claims = verifyConsoleToken(token);
    } catch (error) {
        return deny(res, 401, 'Your super admin session has ended. Sign in again.');
    }
    if (claims.kind !== 'platform' || !claims.platformAdminId) return deny(res, 401, 'Sign in as super admin');

    try {
        const admin = await PlatformAdmin.findById(claims.platformAdminId).select('name email isActive');
        if (!admin || !admin.isActive) return deny(res, 401, 'This super admin account is not active');
        req.platformAdmin = { id: String(admin._id), name: admin.name, email: admin.email };
        return next();
    } catch (error) {
        return next(error);
    }
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Mounted before every route: a super admin viewing a workspace can read,
 * never write. Decoding is enough here (it only ever blocks); the token is
 * verified properly by authMiddleware.
 */
const platformViewGuard = (req, res, next) => {
    if (READ_METHODS.has(req.method)) return next();
    const token = bearer(req);
    const claims = token ? jwt.decode(token) : null;
    if (claims && (claims.kind === 'platform-view' || claims.aud === 'platform-view')) {
        return res.status(403).json({ success: false, code: 'READ_ONLY', message: 'Super admin view is read-only' });
    }
    return next();
};

module.exports = { requirePlatformAdmin, platformViewGuard, READ_METHODS };
