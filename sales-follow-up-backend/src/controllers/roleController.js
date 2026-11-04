const mongoose = require('mongoose');
const Role = require('../models/Role');
const User = require('../models/User');
const {
    can,
    deny,
    invalidateAccess,
    backfillUserRoles,
    assignablePeople,
    legacyRoleFor,
} = require('../services/access');
const { MODULES, SCOPES, SCOPED_MODULES, normalizePermissions, normalizeScopes } = require('../services/access/catalog');
const { canGrantRole } = require('./teamController');

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

const serialize = (role, memberCount = 0) => ({
    _id: role._id,
    name: role.name,
    description: role.description || '',
    key: role.key || null,
    isSystem: !!role.isSystem,
    isBuiltIn: !!role.key,
    permissions: role.key === 'OWNER' ? MODULES.flatMap((m) => m.actions.map((a) => `${m.key}.${a.key}`)) : normalizePermissions(role.permissions),
    scopes: normalizeScopes(role.scopes, role.key === 'OWNER' ? 'all' : 'own'),
    memberCount,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
});

const memberCounts = async (businessId) => {
    const rows = await User.aggregate([
        { $match: { businessId: new mongoose.Types.ObjectId(String(businessId)) } },
        { $group: { _id: '$roleId', count: { $sum: 1 } } },
    ]);
    return new Map(rows.filter((r) => r._id).map((r) => [String(r._id), r.count]));
};

/** Cleans the name, description, permissions and scopes sent for a role */
const readRoleInput = (body, { partial = false } = {}) => {
    const out = {};
    if (!partial || body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (name.length < 2 || name.length > 60) return { error: 'Give the role a name of 2 to 60 characters.' };
        out.name = name;
    }
    if (body.description !== undefined) {
        out.description = typeof body.description === 'string' ? body.description.trim().slice(0, 240) : '';
    }
    if (!partial || body.permissions !== undefined) {
        if (body.permissions !== undefined && !Array.isArray(body.permissions)) return { error: 'Permissions must be a list.' };
        out.permissions = normalizePermissions(body.permissions || []);
    }
    if (!partial || body.scopes !== undefined) {
        const scopes = body.scopes || {};
        for (const [module, scope] of Object.entries(scopes)) {
            if (!SCOPED_MODULES.includes(module) || !SCOPES.includes(scope)) {
                return { error: `Data access for ${module} must be one of: ${SCOPES.join(', ')}.` };
            }
        }
        out.scopes = normalizeScopes(scopes);
    }
    return { value: out };
};

/** The list of permissions and data scopes the Roles screen shows */
const getCatalog = async (req, res) => {
    res.json({
        success: true,
        data: {
            modules: MODULES.map((m) => ({ key: m.key, label: m.label, scoped: !!m.scoped, actions: m.actions })),
            scopes: [
                { key: 'own', label: 'Own records', description: 'Only records assigned to them' },
                { key: 'team', label: 'Their team', description: 'Theirs and everyone who reports to them' },
                { key: 'all', label: 'Everything', description: 'Every record in the business' },
            ],
        },
    });
};

const listRoles = async (req, res, next) => {
    try {
        // The roles screen and the team page (to pick someone's role) both list roles
        if (!can(req, 'settings.roles') && !can(req, 'team.view')) return deny(res);
        await backfillUserRoles(req.user.businessId);
        const [roles, counts] = await Promise.all([
            Role.find({ businessId: req.user.businessId }).lean(),
            memberCounts(req.user.businessId),
        ]);
        const order = { OWNER: 0, SALES_MANAGER: 1, SALESPERSON: 2 };
        roles.sort((a, b) => (order[a.key] ?? 3) - (order[b.key] ?? 3) || a.name.localeCompare(b.name));
        res.json({
            success: true,
            data: roles.map((r) => ({
                ...serialize(r, counts.get(String(r._id)) || 0),
                // Whether the signed-in person may give this role to someone
                grantable: r.key !== 'OWNER' && canGrantRole(req, serialize(r)),
            })),
        });
    } catch (error) {
        next(error);
    }
};

const createRole = async (req, res, next) => {
    try {
        if (!can(req, 'settings.roles')) return deny(res);
        const input = readRoleInput(req.body || {});
        if (input.error) return fail(res, 400, input.error);

        if (!canGrantRole(req, input.value)) {
            return fail(res, 403, 'A role cannot have more access than you have yourself.');
        }

        const role = await Role.create({
            ...input.value,
            businessId: req.user.businessId,
            key: null,
            isSystem: false,
            createdBy: req.user.userId,
            updatedBy: req.user.userId,
        });
        res.status(201).json({ success: true, message: 'Role created', data: serialize(role.toObject()) });
    } catch (error) {
        if (error?.code === 11000) return fail(res, 409, 'A role with this name already exists.');
        next(error);
    }
};

const findRole = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        fail(res, 400, 'Invalid role.');
        return null;
    }
    const role = await Role.findOne({ _id: req.params.id, businessId: req.user.businessId });
    if (!role) {
        fail(res, 404, 'Role not found.');
        return null;
    }
    return role;
};

const updateRole = async (req, res, next) => {
    try {
        if (!can(req, 'settings.roles')) return deny(res);
        const role = await findRole(req, res);
        if (!role) return undefined;

        if (role.isSystem || role.key === 'OWNER') return fail(res, 400, 'The Owner role always has full access and cannot be changed.');
        if (!req.user.isOwner && String(role._id) === String(req.user.roleId)) {
            return fail(res, 403, 'You cannot change your own role. Ask your workspace owner.');
        }
        if (!canGrantRole(req, role.toObject())) {
            return fail(res, 403, 'You cannot change a role that has more access than you.');
        }

        const input = readRoleInput(req.body || {}, { partial: true });
        if (input.error) return fail(res, 400, input.error);

        const proposed = { ...role.toObject(), ...input.value };
        if (!canGrantRole(req, proposed)) return fail(res, 403, 'A role cannot have more access than you have yourself.');

        Object.assign(role, input.value, { updatedBy: req.user.userId });
        await role.save();
        // Everyone with this role gets the change on their next request
        invalidateAccess();

        const counts = await memberCounts(req.user.businessId);
        res.json({ success: true, message: 'Role saved', data: serialize(role.toObject(), counts.get(String(role._id)) || 0) });
    } catch (error) {
        if (error?.code === 11000) return fail(res, 409, 'A role with this name already exists.');
        next(error);
    }
};

/**
 * Deletes a custom role. People who have it move to `reassignTo` (another role)
 * first; built-in roles can be edited but not deleted.
 */
const deleteRole = async (req, res, next) => {
    try {
        if (!can(req, 'settings.roles')) return deny(res);
        const role = await findRole(req, res);
        if (!role) return undefined;

        if (role.key) return fail(res, 400, 'Built-in roles cannot be deleted. You can rename them or change their permissions.');
        if (!canGrantRole(req, role.toObject())) return fail(res, 403, 'You cannot delete a role that has more access than you.');

        const members = await User.countDocuments({ businessId: req.user.businessId, roleId: role._id });
        if (members > 0) {
            const targetId = req.body?.reassignTo ?? req.query.reassignTo;
            if (!targetId || !mongoose.isValidObjectId(targetId) || String(targetId) === String(role._id)) {
                return fail(res, 400, `${members} people have this role. Choose another role for them first.`, {
                    code: 'ROLE_IN_USE',
                    memberCount: members,
                });
            }
            const target = await Role.findOne({ _id: targetId, businessId: req.user.businessId }).lean();
            if (!target || target.key === 'OWNER') return fail(res, 400, 'Choose a valid role to move these people to.');
            if (!canGrantRole(req, target)) return fail(res, 403, 'You cannot give people more access than you have yourself.');

            await User.updateMany(
                { businessId: req.user.businessId, roleId: role._id },
                { $set: { roleId: target._id, role: legacyRoleFor(target) } }
            );
        }

        await role.deleteOne();
        invalidateAccess();
        res.json({ success: true, message: 'Role deleted' });
    } catch (error) {
        next(error);
    }
};

/** People the signed-in person may assign a module's records to (for dropdowns) */
const listAssignable = async (req, res, next) => {
    try {
        const module = req.params.module;
        if (!['leads', 'followups', 'quotations', 'admissions'].includes(module)) return fail(res, 400, 'Unknown module.');
        if (!can(req, `${module}.view`)) return deny(res);
        const people = await assignablePeople(req, module);
        res.json({
            success: true,
            data: people.map((p) => ({ _id: p._id, name: p.name, email: p.email, managerId: p.managerId || null })),
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getCatalog, listRoles, createRole, updateRole, deleteRole, listAssignable };
