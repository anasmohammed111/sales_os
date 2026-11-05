// Platform super admin: tokens, read-only workspace access, login limits, audit.
const jwt = require('jsonwebtoken');
const PlatformAuditLog = require('../../models/PlatformAuditLog');
const { ALL_PERMISSIONS, SCOPED_MODULES } = require('../access/catalog');

const CONSOLE_AUDIENCE = 'platform';
const VIEW_AUDIENCE = 'platform-view';
const CONSOLE_TTL = '8h';
const VIEW_TTL_SECONDS = 60 * 60;

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

const secret = () => {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    return process.env.JWT_SECRET;
};

/** Token for the platform console (/api/platform/*). Never accepted by workspace APIs. */
const signConsoleToken = (admin) =>
    jwt.sign({ kind: 'platform', platformAdminId: String(admin._id) }, secret(), {
        audience: CONSOLE_AUDIENCE,
        expiresIn: CONSOLE_TTL,
    });

/** Short-lived, read-only token for looking inside one workspace. */
const signViewToken = (admin, businessId) =>
    jwt.sign(
        { kind: 'platform-view', platformAdminId: String(admin._id), businessId: String(businessId), readOnly: true },
        secret(),
        { audience: VIEW_AUDIENCE, expiresIn: VIEW_TTL_SECONDS }
    );

const verifyConsoleToken = (token) => jwt.verify(token, secret(), { audience: CONSOLE_AUDIENCE });
const verifyViewToken = (token) => jwt.verify(token, secret(), { audience: VIEW_AUDIENCE });

const bearer = (req) => {
    const [scheme, token] = String(req.headers.authorization || '').split(' ');
    return scheme === 'Bearer' && token ? token : null;
};

// The app shows a super admin only what reading needs: every page, no edit
// buttons. The API still allows every read (exports, settings) and blocks
// every write (see platformViewGuard).
const VIEW_EXTRA = ['admissions.payments', 'admissions.export', 'reports.export', 'admissions.settings', 'settings.business', 'settings.roles'];
const VIEW_PERMISSIONS = ALL_PERMISSIONS.filter((key) => key.endsWith('.view') || VIEW_EXTRA.includes(key));

/** req.user for a super admin looking inside a workspace. */
const viewUser = (admin, businessId) => ({
    userId: String(admin._id),
    businessId: String(businessId),
    role: 'OWNER',
    roleId: null,
    roleKey: 'PLATFORM_VIEW',
    roleName: 'Super admin (read-only)',
    isOwner: true,
    permissions: new Set(ALL_PERMISSIONS),
    // What the app is told it may do (hides every edit button)
    clientPermissions: VIEW_PERMISSIONS,
    scopes: Object.fromEntries(SCOPED_MODULES.map((m) => [m, 'all'])),
    isPlatformView: true,
    platformAdminId: String(admin._id),
    platformAdminName: admin.name,
    platformAdminEmail: admin.email,
});

/** Simple per-IP attempt counter for the platform login (in memory, per process). */
const createRateLimiter = ({ max, windowMs }) => {
    const hits = new Map();
    return (key, now = Date.now()) => {
        const entry = hits.get(key);
        if (!entry || now - entry.start > windowMs) {
            hits.set(key, { start: now, count: 1 });
            return true;
        }
        entry.count += 1;
        return entry.count <= max;
    };
};

const requestIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';

const audit = (req, { platformAdminId = null, action, businessId = null, reason = '', details = {} }) =>
    PlatformAuditLog.create({
        platformAdminId,
        action,
        businessId,
        reason,
        details,
        ip: requestIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    });

module.exports = {
    MAX_FAILED_LOGINS,
    LOCK_MS,
    VIEW_TTL_SECONDS,
    VIEW_PERMISSIONS,
    signConsoleToken,
    signViewToken,
    verifyConsoleToken,
    verifyViewToken,
    bearer,
    viewUser,
    createRateLimiter,
    audit,
};
