const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');
const Lead = require('../models/Leads');
const FollowUp = require('../models/FollowUp');
const bcrypt = require('bcryptjs');
const {
    can,
    invalidateAccess,
    ensureDefaultRoles,
    backfillUserRoles,
    legacyRoleFor,
} = require('../services/access');
const { SCOPES, DEFAULT_ROLES } = require('../services/access/catalog');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const denied = (res) =>
    fail(res, 403, 'You do not have permission to do this. Ask your workspace owner for access.', { code: 'PERMISSION_DENIED' });

/** Team members are everyone in the business except the owner */
const MEMBER_FILTER = { role: { $ne: 'OWNER' } };

const SCOPE_RANK = Object.fromEntries(SCOPES.map((s, i) => [s, i]));

/**
 * Whether this person may give someone `role`. The owner may give any role;
 * anyone else only roles with no permission or data scope beyond their own.
 */
const canGrantRole = (req, role) => {
    if (req.user.isOwner) return true;
    if ((role.permissions || []).some((p) => !req.user.permissions.has(p))) return false;
    return Object.entries(role.scopes || {}).every(
        ([module, scope]) => (SCOPE_RANK[scope] ?? 0) <= (SCOPE_RANK[req.user.scopes?.[module]] ?? 0)
    );
};

/**
 * The role a member should get, from `roleId` or a built-in `role` key
 * (SALES_MANAGER or SALESPERSON, as older clients send). The Owner role is never
 * given through the team page.
 */
const resolveRole = async (req, { roleId, role }) => {
    const defaults = await ensureDefaultRoles(req.user.businessId);
    let found = null;

    if (roleId !== undefined && roleId !== null && roleId !== '') {
        if (!mongoose.isValidObjectId(roleId)) return { status: 400, error: 'Please select a valid role.' };
        found = await Role.findOne({ _id: roleId, businessId: req.user.businessId }).lean();
    } else if (typeof role === 'string' && ['SALES_MANAGER', 'SALESPERSON'].includes(role)) {
        found = defaults.get(role);
    } else {
        return { status: 400, error: 'Please select a valid team member role.' };
    }

    if (!found || found.key === 'OWNER') return { status: 400, error: 'Please select a valid team member role.' };
    if (!canGrantRole(req, found)) {
        return { status: 403, error: 'You cannot give someone more access than you have yourself.' };
    }
    return { role: found };
};

/**
 * Who a member reports to: nobody, or an active person in the business who is
 * not the member and not below them (which would make a loop).
 */
const resolveManager = async (req, managerId, memberId = null) => {
    if (managerId === undefined) return { unchanged: true };
    if (managerId === null || managerId === '') return { managerId: null };
    if (!mongoose.isValidObjectId(managerId)) return { status: 400, error: 'Invalid manager.' };
    if (memberId && String(managerId) === String(memberId)) {
        return { status: 400, error: 'Someone cannot report to themselves.' };
    }

    const manager = await User.findOne({ _id: managerId, businessId: req.user.businessId, isActive: true })
        .select('_id managerId')
        .lean();
    if (!manager) return { status: 400, error: 'The selected manager does not exist or is inactive.' };

    if (memberId) {
        // Walk up from the new manager; reaching the member means a loop
        const people = await User.find({ businessId: req.user.businessId }).select('_id managerId').lean();
        const bossOf = new Map(people.map((p) => [String(p._id), p.managerId ? String(p.managerId) : null]));
        let cursor = String(manager._id);
        const seen = new Set();
        while (cursor && !seen.has(cursor)) {
            if (cursor === String(memberId)) {
                return { status: 400, error: 'That would make someone report to a person who reports to them.' };
            }
            seen.add(cursor);
            cursor = bossOf.get(cursor);
        }
    }

    return { managerId: manager._id };
};

const memberResponse = (member) => ({
    id: member._id,
    _id: member._id,
    name: member.name,
    email: member.email,
    role: member.role,
    roleId: member.roleId,
    managerId: member.managerId,
    isActive: member.isActive,
    createdAt: member.createdAt,
});

const POPULATE_MANAGER = { path: 'managerId', select: 'name email role' };
const POPULATE_ROLE = { path: 'roleId', select: 'name key isSystem' };

const createTeamMember = async (req, res) => {
    try {
        if (!can(req, 'team.create')) return denied(res);

        const { name, email, password, role, roleId, managerId } = req.body || {};

        if (
            typeof name !== 'string' ||
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !name.trim() ||
            !email.trim() ||
            !password ||
            (!role && !roleId)
        ) {
            return fail(res, 400, 'Please fill in all required fields.');
        }

        const trimmedName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();

        if (trimmedName.length < 2 || trimmedName.length > 100) {
            return fail(res, 400, 'Name must be between 2 and 100 characters.');
        }
        if (normalizedEmail.length > 254) return fail(res, 400, 'Email address is too long.');
        if (!EMAIL_PATTERN.test(normalizedEmail)) return fail(res, 400, 'Please enter a valid email address.');
        if (password.length < 8 || password.length > 128) {
            return fail(res, 400, 'Password must be between 8 and 128 characters.');
        }

        const roleResult = await resolveRole(req, { roleId, role });
        if (roleResult.error) return fail(res, roleResult.status, roleResult.error);

        const managerResult = await resolveManager(req, managerId);
        if (managerResult.error) return fail(res, managerResult.status, managerResult.error);

        const existingUser = await User.findOne({ email: normalizedEmail }).lean();
        if (existingUser) return fail(res, 409, 'An account with this email already exists.');

        const hashedPassword = await bcrypt.hash(password, 12);
        const teamMember = await User.create({
            name: trimmedName,
            email: normalizedEmail,
            password: hashedPassword,
            role: legacyRoleFor(roleResult.role),
            roleId: roleResult.role._id,
            managerId: managerResult.managerId ?? null,
            businessId: req.user.businessId,
        });

        const safeMember = await User.findById(teamMember._id)
            .select('-password')
            .populate(POPULATE_MANAGER)
            .populate(POPULATE_ROLE);

        return res.status(201).json({
            success: true,
            message: 'Team member created successfully.',
            data: safeMember,
        });
    } catch (error) {
        if (error.code === 11000 && error.keyPattern?.email) {
            return fail(res, 409, 'An account with this email already exists.');
        }
        console.error('Create team member error:', error);
        return fail(res, 500, 'Unable to create team member. Please try again later.');
    }
};

const getTeamMembers = async (req, res) => {
    try {
        if (!can(req, 'team.view')) return denied(res);

        // People added before roles existed get the built-in role for their type
        const roles = await backfillUserRoles(req.user.businessId);

        const { role = 'ALL', roleId = 'ALL', status = 'ALL', search = '', page = 1, limit = 10 } = req.query;

        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

        const baseFilter = { businessId: req.user.businessId, ...MEMBER_FILTER };
        const filter = { ...baseFilter };

        if (roleId !== 'ALL') {
            if (!mongoose.isValidObjectId(roleId)) return fail(res, 400, 'Invalid role filter.');
            filter.roleId = roleId;
        } else if (role !== 'ALL') {
            const builtIn = roles.get(role);
            if (!builtIn || role === 'OWNER') return fail(res, 400, 'Invalid role filter.');
            filter.roleId = builtIn._id;
        }

        if (status === 'ACTIVE') filter.isActive = true;
        else if (status === 'INACTIVE') filter.isActive = false;
        else if (status !== 'ALL') return fail(res, 400, 'Invalid status filter.');

        if (typeof search === 'string' && search.trim()) {
            const safeSearch = search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [
                { name: { $regex: safeSearch, $options: 'i' } },
                { email: { $regex: safeSearch, $options: 'i' } },
            ];
        }

        const managerRole = roles.get('SALES_MANAGER');
        const salesRole = roles.get('SALESPERSON');
        const [totalMembers, activeMembers, inactiveMembers, salesManagers, salespersons, byRoleRows] = await Promise.all([
            User.countDocuments(baseFilter),
            User.countDocuments({ ...baseFilter, isActive: true }),
            User.countDocuments({ ...baseFilter, isActive: false }),
            managerRole ? User.countDocuments({ ...baseFilter, roleId: managerRole._id }) : 0,
            salesRole ? User.countDocuments({ ...baseFilter, roleId: salesRole._id }) : 0,
            User.aggregate([
                { $match: { businessId: new mongoose.Types.ObjectId(req.user.businessId), role: { $ne: 'OWNER' } } },
                { $group: { _id: '$roleId', count: { $sum: 1 } } },
            ]),
        ]);

        const roleDocs = await Role.find({ businessId: req.user.businessId }).select('name key').lean();
        const roleName = new Map(roleDocs.map((r) => [String(r._id), r]));
        const byRole = byRoleRows
            .filter((row) => row._id && roleName.has(String(row._id)))
            .map((row) => ({ roleId: row._id, name: roleName.get(String(row._id)).name, count: row.count }))
            .sort((a, b) => b.count - a.count);

        const total = await User.countDocuments(filter);
        const teamMembers = await User.find(filter)
            .select('-password')
            .populate(POPULATE_MANAGER)
            .populate(POPULATE_ROLE)
            .sort({ createdAt: -1 })
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize);

        return res.status(200).json({
            success: true,
            summary: { totalMembers, activeMembers, inactiveMembers, salesManagers, salespersons, byRole },
            data: teamMembers,
            pagination: {
                total,
                page: currentPage,
                limit: pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (error) {
        console.error('Get team members error:', error);
        return fail(res, 500, 'Unable to retrieve team members.');
    }
};

/** Loads a member (not the owner) of the person's business, or answers the error */
const findMember = async (req, res, id) => {
    if (!mongoose.isValidObjectId(id)) {
        fail(res, 400, 'Invalid team member ID.');
        return null;
    }
    const member = await User.findOne({ _id: id, businessId: req.user.businessId, ...MEMBER_FILTER });
    if (!member) {
        fail(res, 404, 'Team member not found.');
        return null;
    }
    if (String(member._id) === String(req.user.userId)) {
        fail(res, 403, 'You cannot change your own account here. Ask your workspace owner.');
        return null;
    }

    // Someone whose role has more access than mine stays out of my reach. People
    // without a role record yet have the built-in role for their type.
    const current =
        (member.roleId && (await Role.findOne({ _id: member.roleId, businessId: req.user.businessId }).lean())) ||
        DEFAULT_ROLES[member.role] ||
        DEFAULT_ROLES.SALESPERSON;
    if (!canGrantRole(req, current)) {
        fail(res, 403, 'You cannot change someone who has more access than you.');
        return null;
    }
    return member;
};

const updateTeamMember = async (req, res) => {
    try {
        const body = req.body || {};
        const { name, email, role, roleId, isActive, managerId } = body;

        // Switching someone on or off needs "deactivate"; any other change needs "edit"
        const statusOnly = Object.keys(body).every((key) => key === 'isActive');
        if (!statusOnly && !can(req, 'team.edit')) return denied(res);
        if (isActive !== undefined && !can(req, 'team.deactivate')) return denied(res);

        const teamMember = await findMember(req, res, req.params.id);
        if (!teamMember) return undefined;

        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) return fail(res, 400, 'Name cannot be empty.');
            const trimmedName = name.trim();
            if (trimmedName.length < 2 || trimmedName.length > 100) {
                return fail(res, 400, 'Name must be between 2 and 100 characters.');
            }
            teamMember.name = trimmedName;
        }

        if (email !== undefined) {
            if (typeof email !== 'string' || !email.trim()) return fail(res, 400, 'Email cannot be empty.');
            const normalizedEmail = email.trim().toLowerCase();
            if (normalizedEmail.length > 254) return fail(res, 400, 'Email address is too long.');
            if (!EMAIL_PATTERN.test(normalizedEmail)) return fail(res, 400, 'Please enter a valid email address.');
            const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: teamMember._id } });
            if (existingUser) return fail(res, 409, 'This email is already registered.');
            teamMember.email = normalizedEmail;
        }

        if (roleId !== undefined || role !== undefined) {
            const roleResult = await resolveRole(req, { roleId, role });
            if (roleResult.error) return fail(res, roleResult.status, roleResult.error);
            teamMember.roleId = roleResult.role._id;
            teamMember.role = legacyRoleFor(roleResult.role);
        }

        const managerResult = await resolveManager(req, managerId, teamMember._id);
        if (managerResult.error) return fail(res, managerResult.status, managerResult.error);
        if (!managerResult.unchanged) teamMember.managerId = managerResult.managerId;

        if (isActive !== undefined) {
            if (typeof isActive !== 'boolean') return fail(res, 400, 'isActive must be true or false.');
            teamMember.isActive = isActive;
        }

        await teamMember.save();
        invalidateAccess(teamMember._id);
        await teamMember.populate(POPULATE_MANAGER);
        await teamMember.populate(POPULATE_ROLE);

        return res.status(200).json({
            success: true,
            message: 'Team member updated successfully.',
            data: memberResponse(teamMember),
        });
    } catch (error) {
        console.error('Update team member error:', error);
        if (error.name === 'CastError') return fail(res, 400, 'Invalid team member ID.');
        if (error.code === 11000) return fail(res, 409, 'This email is already registered.');
        return fail(res, 500, 'Unable to update team member.');
    }
};

const deactivateTeamMember = async (req, res) => {
    try {
        if (!can(req, 'team.deactivate')) return denied(res);

        const teamMember = await findMember(req, res, req.params.id);
        if (!teamMember) return undefined;

        if (!teamMember.isActive) return fail(res, 400, 'Team member is already inactive.');

        teamMember.isActive = false;
        await teamMember.save();
        invalidateAccess(teamMember._id);

        return res.status(200).json({
            success: true,
            message: 'Team member deactivated successfully.',
            data: memberResponse(teamMember),
        });
    } catch (error) {
        console.error('Deactivate team member error:', error);
        if (error.name === 'CastError') return fail(res, 400, 'Invalid team member ID.');
        return fail(res, 500, 'Unable to deactivate team member.');
    }
};

const deleteTeamMember = async (req, res) => {
    try {
        if (!can(req, 'team.delete')) return denied(res);

        const teamMember = await findMember(req, res, req.params.id);
        if (!teamMember) return undefined;

        // Prevent deletion if the member still owns active leads or pending follow-ups
        const [activeLeadsCount, activeFollowUpsCount, reports] = await Promise.all([
            Lead.countDocuments({ businessId: req.user.businessId, assignedTo: teamMember._id, isArchived: false }),
            FollowUp.countDocuments({
                businessId: req.user.businessId,
                assignedTo: teamMember._id,
                status: 'PENDING',
                isArchived: false,
            }),
            User.countDocuments({ businessId: req.user.businessId, managerId: teamMember._id }),
        ]);

        if (activeLeadsCount > 0 || activeFollowUpsCount > 0) {
            return fail(
                res,
                400,
                `Cannot delete team member with ${activeLeadsCount} active lead(s) and ${activeFollowUpsCount} pending follow-up(s). Please reassign them or deactivate the member instead.`
            );
        }
        if (reports > 0) {
            return fail(res, 400, `${reports} people report to this member. Give them another manager first, or deactivate the member instead.`);
        }

        await User.deleteOne({ _id: teamMember._id, businessId: req.user.businessId });
        invalidateAccess(teamMember._id);

        return res.status(200).json({ success: true, message: 'Team member permanently deleted.' });
    } catch (error) {
        console.error('Delete team member error:', error);
        if (error.name === 'CastError') return fail(res, 400, 'Invalid team member ID.');
        return fail(res, 500, 'Unable to delete team member.');
    }
};

module.exports = {
    createTeamMember,
    getTeamMembers,
    updateTeamMember,
    deactivateTeamMember,
    deleteTeamMember,
    canGrantRole,
};
