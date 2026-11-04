const jwt = require('jsonwebtoken');
const { loadAccess } = require('../services/access');

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
