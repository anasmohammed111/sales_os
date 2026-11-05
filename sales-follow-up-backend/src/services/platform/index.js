// Platform administration: tokens, support sessions, audit, login limits.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const PlatformAuditLog = require('../../models/PlatformAuditLog');
const { ALL_PERMISSIONS, SCOPED_MODULES } = require('../access/catalog');

const CONSOLE_AUDIENCE = 'platform';
const SUPPORT_AUDIENCE = 'support';
const CONSOLE_TTL = '8h';

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

// Support sessions
const VIEW_SESSION_MINUTES = 60;
const EDIT_SESSION_MINUTES = 30;
const HANDOFF_SECONDS = 120;

const secret = () => {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    return process.env.JWT_SECRET;
};

// --- Console tokens (admin app) -----------------------------------------------

/** Console token; `ver` must match the account's tokenVersion, so it can be revoked. */
const signConsoleToken = (admin) =>
    jwt.sign({ kind: 'platform', platformAdminId: String(admin._id), ver: admin.tokenVersion || 0 }, secret(), {
        audience: CONSOLE_AUDIENCE,
        expiresIn: CONSOLE_TTL,
    });

const verifyConsoleToken = (token) => jwt.verify(token, secret(), { audience: CONSOLE_AUDIENCE });

// --- Support sessions (CRM) -----------------------------------------------------

/** Token for one support session; it is only ever valid while the session record is live. */
const signSupportToken = (session) =>
    jwt.sign(
        {
            kind: 'support',
            sessionId: String(session._id),
            platformAdminId: String(session.platformAdminId),
            businessId: String(session.businessId),
            mode: session.mode,
        },
        secret(),
        { audience: SUPPORT_AUDIENCE, expiresIn: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000)) }
    );

const verifySupportToken = (token) => jwt.verify(token, secret(), { audience: SUPPORT_AUDIENCE });

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const newHandoffCode = () => crypto.randomBytes(24).toString('base64url');

const bearer = (req) => {
    const [scheme, token] = String(req.headers.authorization || '').split(' ');
    return scheme === 'Bearer' && token ? token : null;
};

// The app is told only the permissions reading needs, so every edit button
// disappears; pages people may open stay reachable.
const VIEW_EXTRA = ['admissions.payments', 'admissions.export', 'reports.export', 'admissions.settings', 'settings.business', 'settings.roles'];
const VIEW_PERMISSIONS = ALL_PERMISSIONS.filter((key) => key.endsWith('.view') || VIEW_EXTRA.includes(key));

// What a support-edit session may be allowed to change. Deliberately excluded:
// creating, archiving or deleting records, payments and fees, quotation status
// (financial), overrides, closing files, people and roles, business settings.
const SUPPORT_EDIT_OPTIONS = [
    'leads.edit',
    'leads.assign',
    'followups.edit',
    'followups.assign',
    'pipeline.move',
    'quotations.edit',
    'admissions.edit',
    'admissions.assign',
    'admissions.move',
    'admissions.documents',
    'admissions.settings',
];

// Always refused in a support session, whatever the permissions say
const SUPPORT_BLOCKED_WRITES = [/^\/api\/auth\//, /^\/api\/settings\//, /^\/api\/team/, /^\/api\/roles/, /^\/api\/platform\//];

const allScopes = () => Object.fromEntries(SCOPED_MODULES.map((m) => [m, 'all']));

/** Identity details every support request carries (the real actor). */
const supportInfo = (session, admin, business, targetName) => ({
    sessionId: String(session._id),
    mode: session.mode,
    platformAdminId: String(admin._id),
    adminName: admin.name,
    adminEmail: admin.email,
    businessName: business.businessName,
    targetUserId: session.targetUserId ? String(session.targetUserId) : null,
    targetUserName: targetName,
    expiresAt: session.expiresAt,
});

/**
 * req.user for a read-only view: exactly the target person's access (role,
 * permissions, data scope), so lists and menus match what they see. The app
 * is told only the read permissions among them.
 */
const viewAsUser = ({ access, userId, businessId, support }) => ({
    userId: String(userId),
    businessId: String(businessId),
    role: access.legacyRole,
    roleId: access.roleId,
    roleKey: access.roleKey,
    roleName: access.roleName,
    isOwner: access.isOwner,
    permissions: access.permissions,
    clientPermissions: [...access.permissions].filter((key) => VIEW_PERMISSIONS.includes(key)),
    scopes: access.scopes,
    readOnly: true,
    support,
});

/**
 * req.user for a support-edit session. It acts under the administrator's own
 * id (never a customer's), sees the whole workspace, and may only use the
 * read permissions plus what the session was allowed.
 */
const supportEditor = ({ session, admin, businessId, support }) => {
    const permissions = new Set([...VIEW_PERMISSIONS, ...session.allowedPermissions.filter((p) => SUPPORT_EDIT_OPTIONS.includes(p))]);
    return {
        userId: String(admin._id),
        businessId: String(businessId),
        role: 'SALES_MANAGER',
        roleId: null,
        roleKey: 'KELTO_SUPPORT',
        roleName: 'Kelto support (editing)',
        isOwner: false,
        permissions,
        clientPermissions: [...permissions],
        scopes: allScopes(),
        readOnly: false,
        support,
        // There is no workspace user behind this session
        syntheticProfile: {
            _id: String(admin._id),
            id: String(admin._id),
            name: `${admin.name} (Kelto support)`,
            email: admin.email,
            role: 'SALES_MANAGER',
            businessId: String(businessId),
            isActive: true,
        },
    };
};

/** Read-only view of a workspace whose owner account cannot be found. */
const ownerlessView = ({ admin, businessId, support }) => ({
    userId: String(admin._id),
    businessId: String(businessId),
    role: 'OWNER',
    roleId: null,
    roleKey: 'KELTO_SUPPORT',
    roleName: 'Kelto support (read-only)',
    isOwner: true,
    permissions: new Set(ALL_PERMISSIONS),
    clientPermissions: VIEW_PERMISSIONS,
    scopes: allScopes(),
    readOnly: true,
    support,
    syntheticProfile: {
        _id: String(admin._id),
        id: String(admin._id),
        name: `${admin.name} (Kelto support)`,
        email: admin.email,
        role: 'OWNER',
        businessId: String(businessId),
        isActive: true,
    },
});

/** Simple per-key attempt counter (in memory, per process). */
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

const audit = (req, { platformAdminId = null, action, businessId = null, supportSessionId = null, targetAdminId = null, reason = '', details = {} }) =>
    PlatformAuditLog.create({
        platformAdminId,
        action,
        businessId,
        supportSessionId,
        targetAdminId,
        reason,
        details,
        ip: requestIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    });

module.exports = {
    MAX_FAILED_LOGINS,
    LOCK_MS,
    VIEW_SESSION_MINUTES,
    EDIT_SESSION_MINUTES,
    HANDOFF_SECONDS,
    VIEW_PERMISSIONS,
    SUPPORT_EDIT_OPTIONS,
    SUPPORT_BLOCKED_WRITES,
    signConsoleToken,
    verifyConsoleToken,
    signSupportToken,
    verifySupportToken,
    hashCode,
    newHandoffCode,
    bearer,
    supportInfo,
    viewAsUser,
    supportEditor,
    ownerlessView,
    createRateLimiter,
    requestIp,
    audit,
};
