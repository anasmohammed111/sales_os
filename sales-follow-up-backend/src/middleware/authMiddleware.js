const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { loadAccess } = require('../services/access');
const { suspendedResponse, isBusinessActive } = require('../services/businessStatus');

const unauthorized = (res, message, code) => res.status(401).json({ success: false, message, ...(code && { code }) });

/**
 * A Kelto support session inside one workspace. The session record is read on
 * every request, so ending or revoking it takes effect at once. Read-only
 * modes reproduce the target person's access; support edit acts as the
 * administrator (never as a customer) and audits every change.
 */
const supportSession = async (req, res, next, token) => {
    // Lazy requires keep the normal sign-in path free of platform modules
    const platform = require('../services/platform');
    const SupportSession = require('../models/SupportSession');
    const PlatformAdmin = require('../models/PlatformAdmin');
    const Business = require('../models/Business');
    const User = require('../models/User');

    let claims;
    try {
        claims = platform.verifySupportToken(token);
    } catch {
        return unauthorized(res, 'This support session has ended', 'SUPPORT_SESSION_ENDED');
    }
    if (!mongoose.isValidObjectId(claims.sessionId)) return unauthorized(res, 'This support session has ended', 'SUPPORT_SESSION_ENDED');

    const session = await SupportSession.findById(claims.sessionId);
    if (!session || !session.isLive()) return unauthorized(res, 'This support session has ended', 'SUPPORT_SESSION_ENDED');

    const [admin, business] = await Promise.all([
        PlatformAdmin.findById(session.platformAdminId).select('name email isActive'),
        Business.findById(session.businessId).select('businessName status isActive owner supportAccess'),
    ]);
    if (!admin || !admin.isActive || !business) return unauthorized(res, 'This support session has ended', 'SUPPORT_SESSION_ENDED');

    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

    if (session.mode === 'SUPPORT_EDIT') {
        const allowed = business.supportAccess?.editAllowedUntil && business.supportAccess.editAllowedUntil > new Date();
        if (!allowed || !isBusinessActive(business)) {
            session.status = 'REVOKED';
            session.endedAt = new Date();
            session.endedBy = { kind: 'SYSTEM', id: null };
            session.endReason = allowed ? 'Workspace is not active' : 'The owner no longer allows support edits';
            await session.save();
            return unauthorized(res, `Support session ended: ${session.endReason}`, 'SUPPORT_SESSION_ENDED');
        }
        req.user = platform.supportEditor({
            session,
            admin,
            businessId: business._id,
            support: platform.supportInfo(session, admin, business, null),
        });
        if (writing) {
            // Every change is recorded against the real administrator
            res.on('finish', () => {
                platform
                    .audit(req, {
                        platformAdminId: admin._id,
                        action: 'SUPPORT_ACTION',
                        businessId: business._id,
                        supportSessionId: session._id,
                        details: { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode },
                    })
                    .catch((error) => console.error('[Support] Audit failed:', error.message));
                if (res.statusCode < 400) SupportSession.updateOne({ _id: session._id }, { $inc: { writeCount: 1 } }).catch(() => {});
            });
        }
        return next();
    }

    // Read-only modes (the global guard already refused writes; refuse again here)
    if (writing) {
        return res.status(403).json({ success: false, code: 'READ_ONLY', message: 'This Kelto support session is read-only' });
    }
    const targetId = session.targetUserId;
    const access = targetId ? await loadAccess(String(targetId), String(business._id)) : null;
    if (targetId && !access) return unauthorized(res, 'The person this session views is no longer active', 'SUPPORT_SESSION_ENDED');

    if (access) {
        const target = await User.findById(targetId).select('name');
        req.user = platform.viewAsUser({
            access,
            userId: targetId,
            businessId: business._id,
            support: platform.supportInfo(session, admin, business, target?.name ?? null),
        });
    } else {
        req.user = platform.ownerlessView({ admin, businessId: business._id, support: platform.supportInfo(session, admin, business, null) });
    }
    return next();
};

/**
 * Checks the sign-in token, then loads what the person may do from their role
 * in the database. Permissions are not trusted from the token, so a role
 * change, a deactivation or a company suspension applies on the next request,
 * not at the next login.
 */
const authMiddleware = async (req, res, next) => {
    let decoded;
    let token;
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token is required',
            });
        }

        const [scheme, value] = authHeader.split(' ');
        token = value;

        if (scheme !== 'Bearer' || !token) {
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

        decoded = jwt.decode(token);
        // Support sessions are verified against their own audience below
        if (decoded?.kind !== 'support') decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token',
        });
    }

    // Platform console tokens only work in the admin app (/api/platform)
    if (decoded?.kind === 'platform') {
        return res.status(401).json({ success: false, message: 'Invalid token for this workspace' });
    }

    if (decoded?.kind === 'support') {
        try {
            return await supportSession(req, res, next, token);
        } catch (error) {
            return next(error);
        }
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
        // A suspended or archived company keeps its data but cannot be used
        if (access.businessStatus && access.businessStatus !== 'ACTIVE') return suspendedResponse(res);

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
