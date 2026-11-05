const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { loadAccess } = require('../services/access');
const { viewUser } = require('../services/platform');
const { READ_METHODS } = require('./platformAuth');

/** req.user for a super admin's read-only view of one workspace. */
const platformView = async (req, res, next, decoded) => {
    if (decoded.aud !== 'platform-view' || !mongoose.isValidObjectId(decoded.businessId)) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    if (!READ_METHODS.has(req.method)) {
        return res.status(403).json({ success: false, code: 'READ_ONLY', message: 'Super admin view is read-only' });
    }
    try {
        // Lazy requires keep the normal sign-in path free of platform models
        const PlatformAdmin = require('../models/PlatformAdmin');
        const Business = require('../models/Business');
        const [admin, business] = await Promise.all([
            PlatformAdmin.findById(decoded.platformAdminId).select('name email isActive'),
            Business.exists({ _id: decoded.businessId }),
        ]);
        if (!admin || !admin.isActive || !business) {
            return res.status(401).json({ success: false, message: 'Your account is no longer active' });
        }
        req.user = viewUser(admin, decoded.businessId);
        return next();
    } catch (error) {
        return next(error);
    }
};

/**
 * Checks the sign-in token, then loads what the person may do from their role
 * in the database. Permissions are not trusted from the token, so a role
 * change or a deactivation applies on the next request, not at the next login.
 */
const authMiddleware = async (req, res, next) => {
    let decoded;
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token is required',
            });
        }

        const [scheme, token] = authHeader.split(' ');

        if (
            scheme !== 'Bearer' ||
            !token
        ) {
            return res.status(401).json({
                success: false,
                message: 'Invalid authorization format',
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error('CRITICAL: JWT_SECRET environment variable is not configured');
            return res.status(500).json({
                success: false,
                message: 'Authentication service misconfigured',
            });
        }

        decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token',
        });
    }

    // Platform console tokens only work on /api/platform
    if (decoded?.kind === 'platform') {
        return res.status(401).json({ success: false, message: 'Invalid token for this workspace' });
    }

    // A super admin looking inside one workspace: read-only, every record
    if (decoded?.kind === 'platform-view') {
        return platformView(req, res, next, decoded);
    }

    if (!decoded || !decoded.userId || !decoded.businessId) {
        return res.status(401).json({
            success: false,
            message: 'Invalid token claims',
        });
    }

    try {
        const access = await loadAccess(decoded.userId.toString(), decoded.businessId.toString());
        if (!access) {
            return res.status(401).json({
                success: false,
                message: 'Your account is no longer active',
            });
        }

        req.user = {
            userId: decoded.userId.toString(),
            businessId: decoded.businessId.toString(),
            // Built-in role type (OWNER, SALES_MANAGER, SALESPERSON), kept for compatibility
            role: access.legacyRole,
            roleId: access.roleId,
            roleKey: access.roleKey,
            roleName: access.roleName,
            isOwner: access.isOwner,
            permissions: access.permissions,
            scopes: access.scopes,
        };

        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = authMiddleware;
