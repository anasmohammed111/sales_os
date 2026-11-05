// Tenant side of Kelto support sessions: the CRM exchanges the admin app's
// single-use hand-off code for a session token, can end the session, and the
// workspace owner decides whether support may make changes.
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Business = require('../models/Business');
const SupportSession = require('../models/SupportSession');
const User = require('../models/User');
const { hashCode, signSupportToken, verifySupportToken, bearer, createRateLimiter, requestIp, audit } = require('../services/platform');

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

// 30 exchanges per IP every 15 minutes
const exchangeLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60 * 1000 });

/** POST /api/support/exchange { code } — single use, valid for two minutes. */
const exchange = async (req, res, next) => {
    try {
        if (!exchangeLimiter(requestIp(req))) return fail(res, 429, 'Too many attempts. Try again later.');
        const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
        if (!code) return fail(res, 400, 'Missing support code');

        const now = new Date();
        const session = await SupportSession.findOneAndUpdate(
            {
                handoffCodeHash: hashCode(code),
                handoffUsedAt: null,
                handoffExpiresAt: { $gt: now },
                status: 'ACTIVE',
                expiresAt: { $gt: now },
            },
            { $set: { handoffUsedAt: now, handoffCodeHash: null } },
            { returnDocument: 'after' }
        );
        if (!session) return fail(res, 401, 'This support link has expired or was already used. Start a new session from the admin app.', { code: 'SUPPORT_LINK_INVALID' });

        return res.json({
            success: true,
            data: {
                token: signSupportToken(session),
                expiresAt: session.expiresAt,
                mode: session.mode,
                landingPath: session.landingPath,
            },
        });
    } catch (error) {
        next(error);
    }
};

/** POST /api/support/end — ends the session that sent the request (any mode). */
const end = async (req, res, next) => {
    try {
        const token = bearer(req);
        let claims;
        try {
            claims = token && jwt.decode(token)?.kind === 'support' ? verifySupportToken(token) : null;
        } catch {
            claims = null;
        }
        if (!claims || !mongoose.isValidObjectId(claims.sessionId)) return res.json({ success: true });

        const session = await SupportSession.findOne({ _id: claims.sessionId, status: 'ACTIVE' });
        if (session) {
            session.set({ status: 'ENDED', endedAt: new Date(), endedBy: { kind: 'ADMIN', id: session.platformAdminId }, endReason: 'Ended from the workspace' });
            await session.save();
            await audit(req, {
                platformAdminId: session.platformAdminId,
                action: 'SUPPORT_SESSION_ENDED',
                businessId: session.businessId,
                supportSessionId: session._id,
                reason: 'Ended from the workspace',
            });
        }
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

const ownerOnly = (req, res) => {
    if (req.user.support) return fail(res, 403, 'Support sessions cannot change support access', { code: 'SUPPORT_NOT_ALLOWED' }) && false;
    if (!req.user.isOwner) return fail(res, 403, 'Only the workspace owner can decide this') && false;
    return true;
};

const describeAccess = async (businessId) => {
    const business = await Business.findById(businessId).select('supportAccess').populate('supportAccess.grantedBy', 'name');
    const access = business?.supportAccess || {};
    const until = access.editAllowedUntil && access.editAllowedUntil > new Date() ? access.editAllowedUntil : null;
    const liveEdits = await SupportSession.countDocuments({ businessId, mode: 'SUPPORT_EDIT', status: 'ACTIVE', expiresAt: { $gt: new Date() } });
    return {
        editAllowedUntil: until,
        grantedBy: until && access.grantedBy?.name ? access.grantedBy.name : null,
        grantedAt: until ? access.grantedAt : null,
        liveEditSessions: liveEdits,
    };
};

/** GET /api/settings/support-access — owner only. */
const getSupportAccess = async (req, res, next) => {
    try {
        if (!ownerOnly(req, res)) return undefined;
        return res.json({ success: true, data: await describeAccess(req.user.businessId) });
    } catch (error) {
        next(error);
    }
};

const ALLOWED_HOURS = [0, 4, 24, 72];

/**
 * PUT /api/settings/support-access { hours } — the owner allows Kelto support
 * to make changes for a while (4, 24 or 72 hours), or withdraws it (0), which
 * also ends any support-edit session in progress.
 */
const setSupportAccess = async (req, res, next) => {
    try {
        if (!ownerOnly(req, res)) return undefined;
        const hours = Number(req.body?.hours);
        if (!ALLOWED_HOURS.includes(hours)) return fail(res, 400, 'Choose 4, 24 or 72 hours, or 0 to withdraw');

        const now = new Date();
        const until = hours ? new Date(now.getTime() + hours * 3600_000) : null;
        await Business.updateOne(
            { _id: req.user.businessId },
            { $set: { supportAccess: { editAllowedUntil: until, grantedBy: hours ? req.user.userId : null, grantedAt: hours ? now : null } } }
        );
        if (!hours) {
            await SupportSession.updateMany(
                { businessId: req.user.businessId, mode: 'SUPPORT_EDIT', status: 'ACTIVE' },
                { $set: { status: 'REVOKED', endedAt: now, endedBy: { kind: 'OWNER', id: req.user.userId }, endReason: 'The owner withdrew permission' } }
            );
        }
        const owner = await User.findById(req.user.userId).select('name email');
        await audit(req, {
            action: 'SUPPORT_ACCESS_CHANGED',
            businessId: req.user.businessId,
            details: { byUserId: req.user.userId, byName: owner?.name, hours, until },
        });
        return res.json({ success: true, data: await describeAccess(req.user.businessId) });
    } catch (error) {
        next(error);
    }
};

module.exports = { exchange, end, getSupportAccess, setSupportAccess };
