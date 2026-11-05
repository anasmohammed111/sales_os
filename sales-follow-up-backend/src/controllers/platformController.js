// Platform console: super admins see every workspace. Reads only, apart from
// switching workspace features, and every sign-in, view and change is audited.
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Business = require('../models/Business');
const User = require('../models/User');
const Lead = require('../models/Leads');
const FollowUp = require('../models/FollowUp');
const AdmissionApplication = require('../models/AdmissionApplication');
const PlatformAdmin = require('../models/PlatformAdmin');
const PlatformAuditLog = require('../models/PlatformAuditLog');
const {
    MAX_FAILED_LOGINS,
    LOCK_MS,
    VIEW_TTL_SECONDS,
    VIEW_PERMISSIONS,
    signConsoleToken,
    signViewToken,
    createRateLimiter,
    audit,
} = require('../services/platform');
const { SCOPED_MODULES } = require('../services/access/catalog');

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

// 20 sign-in attempts per IP every 15 minutes
let loginLimiter = createRateLimiter({ max: Number(process.env.PLATFORM_LOGIN_MAX) || 20, windowMs: 15 * 60 * 1000 });
const resetLoginLimiter = () => {
    loginLimiter = createRateLimiter({ max: Number(process.env.PLATFORM_LOGIN_MAX) || 20, windowMs: 15 * 60 * 1000 });
};

// A real hash to compare against when the email is unknown (keeps timing alike)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

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

// --- Sign-in -----------------------------------------------------------------

const login = async (req, res, next) => {
    try {
        const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
        if (!loginLimiter(ip)) return fail(res, 429, 'Too many sign-in attempts. Try again in 15 minutes.');

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
            data: {
                token: signConsoleToken(admin),
                expiresInSeconds: 8 * 60 * 60,
                admin: { id: admin._id, name: admin.name, email: admin.email },
            },
        });
    } catch (error) {
        next(error);
    }
};

const me = (req, res) => res.json({ success: true, data: { admin: req.platformAdmin } });

// --- Workspaces ----------------------------------------------------------------

/** Per-workspace counts and last activity, for the given workspace ids. */
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
    return {
        id,
        businessName: business.businessName,
        email: business.email || '',
        phone: business.phone || '',
        isActive: business.isActive !== false,
        createdAt: business.createdAt,
        features: { admissions: business.features?.admissions === true },
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

const listWorkspaces = async (req, res, next) => {
    try {
        const businesses = await Business.find(searchFilter(req.query.search, ['businessName', 'email']))
            .select('businessName email phone isActive features createdAt')
            .sort({ createdAt: -1 })
            .limit(1000);
        const stats = await workspaceStats(businesses.map((b) => b._id));
        const items = businesses.map((b) => describeWorkspace(b, stats));
        const totals = items.reduce(
            (sum, w) => ({
                workspaces: sum.workspaces + 1,
                users: sum.users + w.counts.users,
                leads: sum.leads + w.counts.leads,
                students: sum.students + w.counts.students,
            }),
            { workspaces: 0, users: 0, leads: 0, students: 0 }
        );
        return res.json({ success: true, data: { items, totals } });
    } catch (error) {
        next(error);
    }
};

const findBusiness = (id) =>
    mongoose.isValidObjectId(id) ? Business.findById(id).select('businessName email phone isActive features createdAt') : null;

const getWorkspace = async (req, res, next) => {
    try {
        const business = await findBusiness(req.params.id);
        if (!business) return fail(res, 404, 'Workspace not found');

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
                    roleName: u.roleId?.name || u.role,
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
                .populate('businessId', 'businessName')
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
                    roleName: u.roleId?.name || u.role,
                    isActive: u.isActive !== false,
                    workspace: u.businessId ? { id: u.businessId._id, businessName: u.businessId.businessName } : null,
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
        if (!business) return fail(res, 404, 'Workspace not found');

        const body = req.body || {};
        const changes = {};
        for (const feature of FEATURES) {
            if (body[feature] === undefined) continue;
            if (typeof body[feature] !== 'boolean') return fail(res, 400, `"${feature}" must be true or false`);
            const from = business.features?.[feature] === true;
            if (from !== body[feature]) changes[feature] = { from, to: body[feature] };
        }
        if (Object.keys(body).some((k) => !FEATURES.includes(k))) return fail(res, 400, `Only these can change: ${FEATURES.join(', ')}`);

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

/** A one-hour, read-only token for looking inside the workspace. */
const openWorkspace = async (req, res, next) => {
    try {
        const business = await findBusiness(req.params.id);
        if (!business) return fail(res, 404, 'Workspace not found');

        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
        if (reason.length < 5) return fail(res, 400, 'Say why you are opening this workspace (at least 5 characters)');
        const path = typeof req.body?.path === 'string' ? req.body.path.slice(0, 200) : '';

        const admin = await PlatformAdmin.findById(req.platformAdmin.id).select('name email');
        await audit(req, {
            platformAdminId: admin._id,
            action: 'VIEW_WORKSPACE',
            businessId: business._id,
            reason,
            details: { ...(path && { firstPath: path }) },
        });

        return res.json({
            success: true,
            data: {
                token: signViewToken(admin, business._id),
                expiresAt: new Date(Date.now() + VIEW_TTL_SECONDS * 1000),
                business: { id: business._id, businessName: business.businessName },
                user: {
                    id: admin._id,
                    name: `${admin.name} (super admin)`,
                    email: admin.email,
                    role: 'OWNER',
                    businessId: business._id,
                },
                access: {
                    roleId: null,
                    roleKey: 'PLATFORM_VIEW',
                    roleName: 'Super admin (read-only)',
                    isOwner: true,
                    permissions: VIEW_PERMISSIONS,
                    scopes: Object.fromEntries(SCOPED_MODULES.map((m) => [m, 'all'])),
                    readOnly: true,
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

const listAudit = async (req, res, next) => {
    try {
        const { limit, page, skip } = paging(req.query, { defaultLimit: 50, maxLimit: 200 });
        const filter = {};
        if (req.query.businessId) {
            if (!mongoose.isValidObjectId(req.query.businessId)) return fail(res, 400, 'Invalid workspace');
            filter.businessId = req.query.businessId;
        }
        const [items, total] = await Promise.all([
            PlatformAuditLog.find(filter)
                .populate('platformAdminId', 'name email')
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
                    workspace: e.businessId ? { id: e.businessId._id, businessName: e.businessId.businessName } : null,
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
    listWorkspaces,
    getWorkspace,
    listUsers,
    updateFeatures,
    openWorkspace,
    listAudit,
    resetLoginLimiter,
};
