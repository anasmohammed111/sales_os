// Kelto admin app: companies, lifecycle, modules, support sessions, audit.
// Every change is audited against the real administrator.
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Business = require('../models/Business');
const User = require('../models/User');
const Lead = require('../models/Leads');
const FollowUp = require('../models/FollowUp');
const AdmissionApplication = require('../models/AdmissionApplication');
const PlatformAdmin = require('../models/PlatformAdmin');
const PlatformAuditLog = require('../models/PlatformAuditLog');
const SupportSession = require('../models/SupportSession');
const { SUPPORT_MODES } = require('../models/SupportSession');
const { DEFAULT_ROLES } = require('../services/access/catalog');
const {
    MAX_FAILED_LOGINS,
    LOCK_MS,
    VIEW_SESSION_MINUTES,
    EDIT_SESSION_MINUTES,
    HANDOFF_SECONDS,
    SUPPORT_EDIT_OPTIONS,
    signConsoleToken,
    hashCode,
    newHandoffCode,
    createRateLimiter,
    requestIp,
    audit,
} = require('../services/platform');
const { roleOf, permissionsOf, PLATFORM_ROLES } = require('../services/platform/roles');
const { businessStatus } = require('../services/businessStatus');
const { invalidateBusiness } = require('../services/access');

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

// 20 sign-in attempts per IP every 15 minutes
const LOGIN_MAX = () => Number(process.env.PLATFORM_LOGIN_MAX) || 20;
let loginLimiter = createRateLimiter({ max: LOGIN_MAX(), windowMs: 15 * 60 * 1000 });
const resetLoginLimiter = () => {
    loginLimiter = createRateLimiter({ max: LOGIN_MAX(), windowMs: 15 * 60 * 1000 });
};

// A real hash to compare against when the email is unknown (keeps timing alike)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const MIN_PASSWORD = 12;
const FEATURES = ['admissions'];

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchFilter = (search, fields) => {
    const term = typeof search === 'string' ? search.trim().slice(0, 100) : '';
    if (!term) return {};
    const pattern = new RegExp(escapeRegex(term), 'i');
    return { $or: fields.map((f) => ({ [f]: pattern })) };
};
const paging = (query, { defaultLimit = 25, maxLimit = 100 } = {}) => {
    const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
    const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
    return { limit, page, skip: (page - 1) * limit };
};
const reasonOf = (body) => (typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '');

/** The signed-in administrator as the admin app sees them. */
const adminView = (admin) => ({
    id: String(admin._id ?? admin.id),
    name: admin.name,
    email: admin.email,
    role: roleOf(admin),
    roleName: PLATFORM_ROLES[roleOf(admin)].name,
    permissions: permissionsOf(admin),
    mustChangePassword: admin.mustChangePassword === true,
});

// --- Sign-in --------------------------------------------------------------------

const login = async (req, res, next) => {
    try {
        if (!loginLimiter(requestIp(req))) return fail(res, 429, 'Too many sign-in attempts. Try again in 15 minutes.');

        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!email || !password) return fail(res, 400, 'Enter your email and password');

        const admin = await PlatformAdmin.findOne({ email }).select('+password');
        const now = new Date();

        if (!admin) {
            await bcrypt.compare(password, DUMMY_HASH);
            await audit(req, { action: 'LOGIN_FAILED', details: { email, why: 'unknown email' } });
            return fail(res, 401, 'Email or password is incorrect');
        }
        if (admin.lockedUntil && admin.lockedUntil > now) {
            await audit(req, { platformAdminId: admin._id, action: 'LOGIN_FAILED', details: { why: 'locked' } });
            const minutes = Math.ceil((admin.lockedUntil - now) / 60000);
            return fail(res, 423, `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, { code: 'LOCKED' });
        }

        const matches = await bcrypt.compare(password, admin.password);
        if (!matches || !admin.isActive) {
            const failedLogins = (admin.failedLogins || 0) + 1;
            const locked = failedLogins >= MAX_FAILED_LOGINS;
            await PlatformAdmin.updateOne(
                { _id: admin._id },
                { $set: locked ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) } : { failedLogins } }
            );
            await audit(req, {
                platformAdminId: admin._id,
                action: 'LOGIN_FAILED',
                details: { why: admin.isActive ? 'wrong password' : 'inactive', ...(locked && { locked: true }) },
            });
            return fail(res, 401, 'Email or password is incorrect');
        }

        await PlatformAdmin.updateOne({ _id: admin._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } });
        await audit(req, { platformAdminId: admin._id, action: 'LOGIN' });

        return res.json({
            success: true,
            data: { token: signConsoleToken(admin), expiresInSeconds: 8 * 60 * 60, admin: adminView(admin) },
        });
    } catch (error) {
        next(error);
    }
};

const me = async (req, res, next) => {
    try {
        const admin = await PlatformAdmin.findById(req.platformAdmin.id).select('name email role mustChangePassword');
        return res.json({ success: true, data: { admin: adminView(admin) } });
    } catch (error) {
        next(error);
    }
};

/** Change your own password. Signs out every other session and returns a fresh token. */
const changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD || newPassword.length > 200) {
            return fail(res, 400, `Choose a new password of at least ${MIN_PASSWORD} characters`);
        }
        const admin = await PlatformAdmin.findById(req.platformAdmin.id).select('+password');
        if (!(await bcrypt.compare(String(currentPassword || ''), admin.password))) {
            return fail(res, 400, 'Your current password is not correct');
        }
        if (await bcrypt.compare(newPassword, admin.password)) return fail(res, 400, 'Choose a password different from the current one');

        admin.password = await bcrypt.hash(newPassword, 12);
        admin.mustChangePassword = false;
        admin.passwordChangedAt = new Date();
        admin.tokenVersion = (admin.tokenVersion || 0) + 1;
        await admin.save();
        await audit(req, { platformAdminId: admin._id, action: 'PASSWORD_CHANGED' });

        return res.json({ success: true, message: 'Password changed', data: { token: signConsoleToken(admin), admin: adminView(admin) } });
    } catch (error) {
        next(error);
    }
};

// --- Companies --------------------------------------------------------------------

/** Per-company counts and last activity, for the given company ids. */
const workspaceStats = async (ids) => {
    const match = { businessId: { $in: ids } };
    const group = (extra = {}) => ({ $group: { _id: '$businessId', n: { $sum: 1 }, last: { $max: '$updatedAt' }, ...extra } });
    const [users, leads, students, followUps] = await Promise.all([
        User.aggregate([{ $match: match }, group({ active: { $sum: { $cond: [{ $eq: ['$isActive', false] }, 0, 1] } } })]),
        Lead.aggregate([{ $match: { ...match, isArchived: { $ne: true } } }, group()]),
        AdmissionApplication.aggregate([
            { $match: match },
            group({ active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } } }),
        ]),
        FollowUp.aggregate([{ $match: match }, group()]),
    ]);
    const byId = (rows) => new Map(rows.map((r) => [String(r._id), r]));
    return { users: byId(users), leads: byId(leads), students: byId(students), followUps: byId(followUps) };
};

const describeWorkspace = (business, stats) => {
    const id = String(business._id);
    const u = stats.users.get(id);
    const l = stats.leads.get(id);
    const s = stats.students.get(id);
    const f = stats.followUps.get(id);
    const times = [u?.last, l?.last, s?.last, f?.last].filter(Boolean).map((d) => new Date(d).getTime());
    const editUntil = business.supportAccess?.editAllowedUntil;
    return {
        id,
        businessName: business.businessName,
        email: business.email || '',
        phone: business.phone || '',
        status: businessStatus(business),
        statusReason: business.statusReason || '',
        statusChangedAt: business.statusChangedAt || null,
        isActive: businessStatus(business) === 'ACTIVE',
        createdAt: business.createdAt,
        features: { admissions: business.features?.admissions === true },
        // The owner's permission for support edits (null when not allowed now)
        supportEditAllowedUntil: editUntil && editUntil > new Date() ? editUntil : null,
        counts: {
            users: u?.n ?? 0,
            activeUsers: u?.active ?? 0,
            leads: l?.n ?? 0,
            students: s?.n ?? 0,
            activeStudents: s?.active ?? 0,
        },
        lastActivityAt: times.length ? new Date(Math.max(...times)) : null,
    };
};

const BUSINESS_FIELDS = 'businessName email phone status statusReason statusChangedAt isActive features supportAccess owner createdAt';

const listWorkspaces = async (req, res, next) => {
    try {
        const filter = searchFilter(req.query.search, ['businessName', 'email']);
        const businesses = await Business.find(filter).select(BUSINESS_FIELDS).sort({ createdAt: -1 }).limit(1000);
        const stats = await workspaceStats(businesses.map((b) => b._id));
        let items = businesses.map((b) => describeWorkspace(b, stats));
        const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : '';
        if (['ACTIVE', 'SUSPENDED', 'ARCHIVED'].includes(status)) items = items.filter((w) => w.status === status);
        const totals = items.reduce(
            (sum, w) => ({
                workspaces: sum.workspaces + 1,
                users: sum.users + w.counts.users,
                leads: sum.leads + w.counts.leads,
                students: sum.students + w.counts.students,
                suspended: sum.suspended + (w.status === 'SUSPENDED' ? 1 : 0),
            }),
            { workspaces: 0, users: 0, leads: 0, students: 0, suspended: 0 }
        );
        return res.json({ success: true, data: { items, totals } });
    } catch (error) {
        next(error);
    }
};

const findBusiness = (id) => (mongoose.isValidObjectId(id) ? Business.findById(id).select(BUSINESS_FIELDS) : null);

const getWorkspace = async (req, res, next) => {
    try {
        const business = await findBusiness(req.params.id);
        if (!business) return fail(res, 404, 'Company not found');

        const [stats, users] = await Promise.all([
            workspaceStats([business._id]),
            User.find({ businessId: business._id })
                .select('name email role roleId isActive createdAt')
                .populate('roleId', 'name')
                .sort({ createdAt: 1 }),
        ]);
        return res.json({
            success: true,
            data: {
                ...describeWorkspace(business, stats),
                users: users.map((u) => ({
                    id: u._id,
                    name: u.name,
                    email: u.email,
                    roleName: u.roleId?.name || DEFAULT_ROLES[u.role]?.name || u.role,
                    isOwner: u.role === 'OWNER' || String(business.owner) === String(u._id),
                    isActive: u.isActive !== false,
                    createdAt: u.createdAt,
                })),
            },
        });
    } catch (error) {
        next(error);
    }
};

const listUsers = async (req, res, next) => {
    try {
        const { limit, page, skip } = paging(req.query);
        const filter = searchFilter(req.query.search, ['name', 'email']);
        const [items, total] = await Promise.all([
            User.find(filter)
                .select('name email role roleId isActive businessId createdAt')
                .populate('businessId', 'businessName status isActive')
                .populate('roleId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            User.countDocuments(filter),
        ]);
        return res.json({
            success: true,
            data: {
                items: items.map((u) => ({
                    id: u._id,
                    name: u.name,
                    email: u.email,
                    roleName: u.roleId?.name || DEFAULT_ROLES[u.role]?.name || u.role,
                    isActive: u.isActive !== false,
                    workspace: u.businessId
                        ? { id: u.businessId._id, businessName: u.businessId.businessName, status: businessStatus(u.businessId) }
                        : null,
                    createdAt: u.createdAt,
                })),
                total,
                page,
                limit,
            },
        });
    } catch (error) {
        next(error);
    }
};

const updateFeatures = async (req, res, next) => {
    try {
        const business = await findBusiness(req.params.id);
        if (!business) return fail(res, 404, 'Company not found');

        const body = req.body || {};
        if (Object.keys(body).some((k) => !FEATURES.includes(k))) return fail(res, 400, `Only these can change: ${FEATURES.join(', ')}`);
        const changes = {};
        for (const feature of FEATURES) {
            if (body[feature] === undefined) continue;
            if (typeof body[feature] !== 'boolean') return fail(res, 400, `"${feature}" must be true or false`);
            const from = business.features?.[feature] === true;
            if (from !== body[feature]) changes[feature] = { from, to: body[feature] };
        }

        for (const [feature, change] of Object.entries(changes)) {
            business.set(`features.${feature}`, change.to);
            await audit(req, {
                platformAdminId: req.platformAdmin.id,
                action: 'FEATURE_CHANGED',
                businessId: business._id,
                details: { feature, ...change },
            });
        }
        if (Object.keys(changes).length) await business.save();

        const stats = await workspaceStats([business._id]);
        return res.json({ success: true, data: describeWorkspace(business, stats) });
    } catch (error) {
        next(error);
    }
};

/** Ends live support sessions (all, or only support edits) for a company or an administrator. */
const endSessions = async (filter, { kind, id, reason, status = 'REVOKED' }) =>
    SupportSession.updateMany(
        { ...filter, status: 'ACTIVE' },
        { $set: { status, endedAt: new Date(), endedBy: { kind, id }, endReason: reason } }
    );

const setLifecycle = (to, action) => async (req, res, next) => {
    try {
        const business = await findBusiness(req.params.id);
        if (!business) return fail(res, 404, 'Company not found');
        const reason = reasonOf(req.body);
        if (reason.length < 5) return fail(res, 400, 'Give a reason (at least 5 characters)');
        const from = businessStatus(business);
        if (from === to) return fail(res, 409, `The company is already ${to.toLowerCase()}`);
        if (from === 'ARCHIVED') return fail(res, 409, 'Archived companies cannot be changed here');

        business.set({
            status: to,
            isActive: to === 'ACTIVE',
            statusReason: reason,
            statusChangedAt: new Date(),
            statusChangedBy: req.platformAdmin.id,
        });
        await business.save();
        // Signed-in people are refused from their next request
        invalidateBusiness(business._id);
        if (to !== 'ACTIVE') {
            await endSessions(
                { businessId: business._id, mode: 'SUPPORT_EDIT' },
                { kind: 'SYSTEM', id: null, reason: 'Company suspended' }
            );
        }
        await audit(req, { platformAdminId: req.platformAdmin.id, action, businessId: business._id, reason, details: { from, to } });

        const stats = await workspaceStats([business._id]);
        return res.json({ success: true, data: describeWorkspace(business, stats) });
    } catch (error) {
        next(error);
    }
};

const suspendWorkspace = setLifecycle('SUSPENDED', 'COMPANY_SUSPENDED');
const reactivateWorkspace = setLifecycle('ACTIVE', 'COMPANY_REACTIVATED');

// --- Support sessions -------------------------------------------------------------

const LANDING = /^\/(dashboard|leads|follow-ups|pipeline|quotations|reports|team|settings|admissions(\/[a-z-]+)?)$/;

const describeSession = (s) => ({
    id: String(s._id),
    mode: s.mode,
    status: s.status === 'ACTIVE' && s.expiresAt <= new Date() ? 'EXPIRED' : s.status,
    admin: s.platformAdminId?.name ? { id: String(s.platformAdminId._id), name: s.platformAdminId.name, email: s.platformAdminId.email } : null,
    workspace: s.businessId?.businessName ? { id: String(s.businessId._id), businessName: s.businessId.businessName } : null,
    targetUser: s.targetUserId?.name ? { id: String(s.targetUserId._id), name: s.targetUserId.name, email: s.targetUserId.email } : null,
    reason: s.reason,
    allowedPermissions: s.allowedPermissions || [],
    startedAt: s.startedAt,
    expiresAt: s.expiresAt,
    endedAt: s.endedAt,
    endReason: s.endReason,
    writeCount: s.writeCount || 0,
});

const populateSession = (query) =>
    query.populate('platformAdminId', 'name email').populate('businessId', 'businessName').populate('targetUserId', 'name email');

/**
 * Starts a support session and returns a single-use hand-off code for the CRM.
 * One live session per administrator: starting another ends the previous one.
 */
const startSupportSession = async (req, res, next) => {
    try {
        const business = await findBusiness(req.params.id);
        if (!business) return fail(res, 404, 'Company not found');

        const body = req.body || {};
        const mode = body.mode;
        if (!SUPPORT_MODES.includes(mode)) return fail(res, 400, 'Choose how to open the company');
        if (mode === 'SUPPORT_EDIT' && !req.platformAdmin.permissions.has('support.edit')) {
            return fail(res, 403, 'Your administrator role does not allow support edits', { code: 'PLATFORM_PERMISSION_DENIED' });
        }
        const reason = reasonOf(body);
        if (reason.length < 5) return fail(res, 400, 'Say why you are opening this company (at least 5 characters)');
        const landingPath = typeof body.landingPath === 'string' && LANDING.test(body.landingPath) ? body.landingPath : '/dashboard';

        let targetUserId = null;
        let allowedPermissions = [];
        let minutes = VIEW_SESSION_MINUTES;
        const now = new Date();

        if (mode === 'VIEW_USER') {
            const user = mongoose.isValidObjectId(body.userId)
                ? await User.findOne({ _id: body.userId, businessId: business._id }).select('isActive')
                : null;
            if (!user) return fail(res, 404, 'That person is not in this company');
            if (user.isActive === false) return fail(res, 409, 'That person is deactivated');
            targetUserId = user._id;
        } else if (mode === 'VIEW_OWNER') {
            const owner =
                (business.owner && (await User.findOne({ _id: business.owner, businessId: business._id }).select('isActive'))) ||
                (await User.findOne({ businessId: business._id, role: 'OWNER', isActive: { $ne: false } }).select('isActive'));
            targetUserId = owner?.isActive === false ? null : owner?._id ?? null;
        } else {
            // SUPPORT_EDIT: only an active company whose owner allows it, and only listed operations
            if (businessStatus(business) !== 'ACTIVE') return fail(res, 409, 'Support edits are not possible while the company is suspended');
            const until = business.supportAccess?.editAllowedUntil;
            if (!until || until <= now) {
                return fail(res, 409, "The company owner hasn't allowed Kelto support to make changes", { code: 'OWNER_AUTHORIZATION_REQUIRED' });
            }
            const requested = Array.isArray(body.allowedPermissions) ? body.allowedPermissions : [];
            allowedPermissions = [...new Set(requested.filter((p) => SUPPORT_EDIT_OPTIONS.includes(p)))];
            if (!allowedPermissions.length || allowedPermissions.length !== new Set(requested).size) {
                return fail(res, 400, 'Choose what this session may change (from the allowed list only)');
            }
            minutes = Math.min(EDIT_SESSION_MINUTES, Math.floor((until - now) / 60000));
            if (minutes < 1) return fail(res, 409, "The owner's permission is about to end");
        }

        // No parallel or nested sessions
        await endSessions(
            { platformAdminId: req.platformAdmin.id },
            { kind: 'ADMIN', id: req.platformAdmin.id, reason: 'Replaced by a new session', status: 'ENDED' }
        );

        const code = newHandoffCode();
        const session = await SupportSession.create({
            platformAdminId: req.platformAdmin.id,
            businessId: business._id,
            mode,
            targetUserId,
            reason,
            allowedPermissions,
            landingPath,
            expiresAt: new Date(now.getTime() + minutes * 60000),
            handoffCodeHash: hashCode(code),
            handoffExpiresAt: new Date(now.getTime() + HANDOFF_SECONDS * 1000),
            ip: requestIp(req),
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        });
        await audit(req, {
            platformAdminId: req.platformAdmin.id,
            action: 'SUPPORT_SESSION_STARTED',
            businessId: business._id,
            supportSessionId: session._id,
            reason,
            details: { mode, targetUserId, allowedPermissions, landingPath, minutes },
        });

        const saved = await populateSession(SupportSession.findById(session._id));
        return res.status(201).json({
            success: true,
            data: { session: describeSession(saved), handoffCode: code, handoffExpiresAt: session.handoffExpiresAt },
        });
    } catch (error) {
        next(error);
    }
};

const listSupportSessions = async (req, res, next) => {
    try {
        const { limit, page, skip } = paging(req.query, { defaultLimit: 50, maxLimit: 200 });
        const filter = {};
        const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : '';
        if (status === 'ACTIVE') Object.assign(filter, { status: 'ACTIVE', expiresAt: { $gt: new Date() } });
        else if (['ENDED', 'REVOKED'].includes(status)) filter.status = status;
        if (req.query.businessId) {
            if (!mongoose.isValidObjectId(req.query.businessId)) return fail(res, 400, 'Invalid company');
            filter.businessId = req.query.businessId;
        }
        const [items, total] = await Promise.all([
            populateSession(SupportSession.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)),
            SupportSession.countDocuments(filter),
        ]);
        return res.json({ success: true, data: { items: items.map(describeSession), total, page, limit } });
    } catch (error) {
        next(error);
    }
};

/** Ends a support session now. Your own: always; anyone's: sessions.revoke. */
const revokeSupportSession = async (req, res, next) => {
    try {
        const session = mongoose.isValidObjectId(req.params.id) ? await SupportSession.findById(req.params.id) : null;
        if (!session) return fail(res, 404, 'Support session not found');
        const own = String(session.platformAdminId) === req.platformAdmin.id;
        if (!own && !req.platformAdmin.permissions.has('sessions.revoke')) {
            return fail(res, 403, 'Your administrator role does not allow this', { code: 'PLATFORM_PERMISSION_DENIED' });
        }
        if (!session.isLive()) return fail(res, 409, 'This session has already ended');

        const reason = reasonOf(req.body) || (own ? 'Ended by the administrator' : '');
        if (!own && reason.length < 5) return fail(res, 400, "Give a reason for ending someone else's session");
        session.set({ status: own ? 'ENDED' : 'REVOKED', endedAt: new Date(), endedBy: { kind: 'ADMIN', id: req.platformAdmin.id }, endReason: reason });
        await session.save();
        await audit(req, {
            platformAdminId: req.platformAdmin.id,
            action: own ? 'SUPPORT_SESSION_ENDED' : 'SUPPORT_SESSION_REVOKED',
            businessId: session.businessId,
            supportSessionId: session._id,
            reason,
        });
        const saved = await populateSession(SupportSession.findById(session._id));
        return res.json({ success: true, data: describeSession(saved) });
    } catch (error) {
        next(error);
    }
};

const supportEditOptions = (req, res) => res.json({ success: true, data: { permissions: SUPPORT_EDIT_OPTIONS, maxMinutes: EDIT_SESSION_MINUTES } });

// --- Audit ------------------------------------------------------------------------

const listAudit = async (req, res, next) => {
    try {
        const { limit, page, skip } = paging(req.query, { defaultLimit: 50, maxLimit: 200 });
        const filter = {};
        for (const [param, field] of [
            ['businessId', 'businessId'],
            ['adminId', 'platformAdminId'],
            ['supportSessionId', 'supportSessionId'],
        ]) {
            if (!req.query[param]) continue;
            if (!mongoose.isValidObjectId(req.query[param])) return fail(res, 400, `Invalid ${param}`);
            filter[field] = req.query[param];
        }
        if (typeof req.query.action === 'string' && req.query.action) filter.action = req.query.action.toUpperCase();
        const [items, total] = await Promise.all([
            PlatformAuditLog.find(filter)
                .populate('platformAdminId', 'name email')
                .populate('targetAdminId', 'name email')
                .populate('businessId', 'businessName')
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit),
            PlatformAuditLog.countDocuments(filter),
        ]);
        return res.json({
            success: true,
            data: {
                items: items.map((e) => ({
                    id: e._id,
                    action: e.action,
                    admin: e.platformAdminId ? { id: e.platformAdminId._id, name: e.platformAdminId.name, email: e.platformAdminId.email } : null,
                    targetAdmin: e.targetAdminId ? { id: e.targetAdminId._id, name: e.targetAdminId.name, email: e.targetAdminId.email } : null,
                    workspace: e.businessId ? { id: e.businessId._id, businessName: e.businessId.businessName } : null,
                    supportSessionId: e.supportSessionId,
                    reason: e.reason,
                    details: e.details,
                    ip: e.ip,
                    createdAt: e.createdAt,
                })),
                total,
                page,
                limit,
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    login,
    me,
    changePassword,
    listWorkspaces,
    getWorkspace,
    listUsers,
    updateFeatures,
    suspendWorkspace,
    reactivateWorkspace,
    startSupportSession,
    listSupportSessions,
    revokeSupportSession,
    supportEditOptions,
    listAudit,
    endSessions,
    adminView,
    resetLoginLimiter,
    MIN_PASSWORD,
};
