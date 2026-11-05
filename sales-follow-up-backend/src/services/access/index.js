/**
 * Who may do what. Every request carries the signed-in person's permissions
 * and data scopes (loaded by authMiddleware from their role), and controllers
 * ask this module instead of checking role names.
 *
 *   can(req, 'leads.edit')                     -> boolean
 *   requirePermission('leads.edit')            -> route middleware (403 when missing)
 *   await scopeFilter(req, 'leads')            -> {} | { assignedTo: { $in: [...] } }
 *   await visibleUserIds(req, 'leads')         -> null (everyone) | [ids]
 *   await canAssignTo(req, 'leads', userId)    -> boolean
 */
const mongoose = require('mongoose');
const Role = require('../../models/Role');
const User = require('../../models/User');
const {
    DEFAULT_ROLES,
    normalizePermissions,
    normalizeScopes,
    legacyRoleFor,
} = require('./catalog');

// ---------------------------------------------------------------------------
// Loading a person's access
// ---------------------------------------------------------------------------

const CACHE_MS = 15_000;
const cache = new Map(); // userId -> { at, access }

/** Forget cached access (after a role or a person changes), so it applies now */
const invalidateAccess = (userId = null) => {
    if (userId) cache.delete(String(userId));
    else cache.clear();
};

const describe = (role) => ({
    roleId: role._id ? String(role._id) : null,
    roleKey: role.key || null,
    roleName: role.name,
    isOwner: role.key === 'OWNER',
    permissions: new Set(role.key === 'OWNER' ? DEFAULT_ROLES.OWNER.permissions : normalizePermissions(role.permissions)),
    scopes: role.key === 'OWNER' ? DEFAULT_ROLES.OWNER.scopes : normalizeScopes(role.scopes),
});

/**
 * The access of an active user, or null when they no longer exist or are
 * deactivated. People without a role record yet use the built-in role that
 * matches their role type.
 */
const loadAccess = async (userId, businessId) => {
    const hit = cache.get(String(userId));
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.access;

    if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(businessId)) return null;
    const user = await User.findOne({ _id: userId, businessId }).select('role roleId isActive').lean();
    if (!user || user.isActive === false) {
        cache.delete(String(userId));
        return null;
    }

    let role = null;
    if (user.roleId) role = await Role.findOne({ _id: user.roleId, businessId }).lean();
    if (!role) role = DEFAULT_ROLES[user.role] || DEFAULT_ROLES.SALESPERSON;
    // The Owner role always belongs to the owner type, whatever the record says
    if (user.role === 'OWNER') role = { ...role, key: 'OWNER' };

    const access = { ...describe(role), legacyRole: user.role };
    cache.set(String(userId), { at: Date.now(), access });
    return access;
};

/** What the signed-in person may do, for the app (GET /api/auth/me) */
const publicAccess = (req) => ({
    roleId: req.user.roleId,
    roleKey: req.user.roleKey,
    roleName: req.user.roleName,
    isOwner: req.user.isOwner,
    // A super admin's read-only view is told only the read permissions
    permissions: [...(req.user.clientPermissions || req.user.permissions || [])],
    scopes: req.user.scopes,
    readOnly: req.user.isPlatformView === true,
});

// ---------------------------------------------------------------------------
// Permission checks
// ---------------------------------------------------------------------------

const can = (req, permission) => !!req.user?.permissions?.has(permission);

const PERMISSION_MESSAGE = "You don't have permission to do this. Ask your workspace owner for access.";

/** Route middleware: every listed permission is needed */
const requirePermission =
    (...permissions) =>
    (req, res, next) => {
        if (permissions.every((p) => can(req, p))) return next();
        return res.status(403).json({ success: false, code: 'PERMISSION_DENIED', message: PERMISSION_MESSAGE });
    };

/** Route middleware: any one of the listed permissions is enough */
const requireAnyPermission =
    (...permissions) =>
    (req, res, next) => {
        if (permissions.some((p) => can(req, p))) return next();
        return res.status(403).json({ success: false, code: 'PERMISSION_DENIED', message: PERMISSION_MESSAGE });
    };

const deny = (res, message = PERMISSION_MESSAGE) =>
    res.status(403).json({ success: false, code: 'PERMISSION_DENIED', message });

// ---------------------------------------------------------------------------
// Data scope
// ---------------------------------------------------------------------------

const scopeOf = (req, module) => req.user?.scopes?.[module] || 'own';

/**
 * The person and everyone below them in the "reports to" chain, at any depth.
 * Worked out once per request.
 */
const teamIds = async (req) => {
    if (req._teamIds) return req._teamIds;
    const me = String(req.user.userId);
    const people = await User.find({ businessId: req.user.businessId }).select('_id managerId').lean();
    const reports = new Map();
    for (const p of people) {
        if (!p.managerId) continue;
        const boss = String(p.managerId);
        if (!reports.has(boss)) reports.set(boss, []);
        reports.get(boss).push(String(p._id));
    }
    const seen = new Set([me]);
    const queue = [me];
    while (queue.length) {
        for (const id of reports.get(queue.shift()) || []) {
            if (!seen.has(id)) {
                seen.add(id);
                queue.push(id);
            }
        }
    }
    req._teamIds = [...seen].map((id) => new mongoose.Types.ObjectId(id));
    return req._teamIds;
};

/** People whose records this person can see in a module; null means everyone */
const visibleUserIds = async (req, module) => {
    const scope = scopeOf(req, module);
    if (scope === 'all') return null;
    if (scope === 'team') return teamIds(req);
    return [new mongoose.Types.ObjectId(String(req.user.userId))];
};

/** Mongo filter limiting a module's records to this person's scope */
const scopeFilter = async (req, module, field = 'assignedTo') => {
    const ids = await visibleUserIds(req, module);
    return ids ? { [field]: { $in: ids } } : {};
};

/** Whether a record assigned to `userId` is inside this person's scope */
const inScope = async (req, module, userId) => {
    const ids = await visibleUserIds(req, module);
    if (!ids) return true;
    if (!userId) return false;
    return ids.some((id) => id.toString() === String(userId));
};

/**
 * Whether this person may give a record to `userId` (null = unassigned).
 * Needs the module's "assign" permission for anyone but themselves, and the
 * person must be inside their scope. Only an "all" scope can unassign,
 * because an unassigned record leaves every narrower scope.
 */
const canAssignTo = async (req, module, userId) => {
    if (userId === null || userId === undefined || userId === '') {
        return can(req, `${module}.assign`) && scopeOf(req, module) === 'all';
    }
    if (String(userId) === String(req.user.userId)) return true;
    if (!can(req, `${module}.assign`)) return false;
    return inScope(req, module, userId);
};

/** Active people this person may assign a module's records to */
const assignablePeople = async (req, module) => {
    const filter = { businessId: req.user.businessId, isActive: true };
    if (!can(req, `${module}.assign`)) {
        filter._id = req.user.userId;
    } else {
        const ids = await visibleUserIds(req, module);
        if (ids) filter._id = { $in: ids };
    }
    return User.find(filter).select('name email role roleId managerId').sort({ name: 1 }).lean();
};

// ---------------------------------------------------------------------------
// Role records
// ---------------------------------------------------------------------------

/** Creates the three built-in roles for a business if they are missing */
const ensureDefaultRoles = async (businessId) => {
    const existing = await Role.find({ businessId, key: { $ne: null } }).lean();
    const byKey = new Map(existing.map((r) => [r.key, r]));
    for (const def of Object.values(DEFAULT_ROLES)) {
        if (byKey.has(def.key)) continue;
        try {
            const created = await Role.create({ ...def, businessId });
            byKey.set(def.key, created.toObject());
        } catch (error) {
            // Created by a parallel request in the meantime
            if (error?.code !== 11000) throw error;
            byKey.set(def.key, await Role.findOne({ businessId, key: def.key }).lean());
        }
    }
    return byKey;
};

/** Gives everyone without a role record the built-in role matching their type */
const backfillUserRoles = async (businessId) => {
    const roles = await ensureDefaultRoles(businessId);
    for (const key of Object.keys(DEFAULT_ROLES)) {
        const role = roles.get(key);
        if (!role) continue;
        await User.updateMany({ businessId, role: key, roleId: null }, { $set: { roleId: role._id } });
    }
    invalidateAccess();
    return roles;
};

module.exports = {
    loadAccess,
    invalidateAccess,
    publicAccess,
    can,
    deny,
    requirePermission,
    requireAnyPermission,
    scopeOf,
    teamIds,
    visibleUserIds,
    scopeFilter,
    inScope,
    canAssignTo,
    assignablePeople,
    ensureDefaultRoles,
    backfillUserRoles,
    legacyRoleFor,
    PERMISSION_MESSAGE,
};
