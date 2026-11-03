const mongoose = require('mongoose');
const Business = require('../../models/Business');
const User = require('../../models/User');
const AdmissionApplication = require('../../models/AdmissionApplication');
const { ensureConfig } = require('./configService');

const STAFF_ROLES = ['OWNER', 'SALES_MANAGER', 'SALESPERSON'];

const isAdmin = (req) => req.user?.role === 'OWNER';

/**
 * Express middleware for every admissions route. Answers 404 when the
 * business hasn't enabled the module, so other tenants never see it.
 */
const requireAdmissions = async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.user?.businessId) || !mongoose.isValidObjectId(req.user?.userId)) {
            return res.status(401).json({ success: false, message: 'Invalid token claims' });
        }

        const business = await Business.findById(req.user.businessId).select('businessName isActive features');

        if (!business || !business.isActive || business.features?.admissions !== true) {
            return res.status(404).json({ success: false, message: 'Admissions module is not enabled' });
        }

        req.business = business;
        req.admissionsConfig = await ensureConfig(business._id);
        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Counsellor ids whose applications the user may see.
 * Returns null for the owner (everything in the business).
 */
const getScopedCounsellorIds = async (req) => {
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    if (req.user.role === 'OWNER') return null;
    if (req.user.role === 'SALESPERSON') return [userId];

    if (req.user.role === 'SALES_MANAGER') {
        const team = await User.find({
            businessId: req.user.businessId,
            managerId: req.user.userId,
            role: 'SALESPERSON',
        }).select('_id');
        return [userId, ...team.map((u) => u._id)];
    }

    return [];
};

/** Mongo filter limiting applications to the user's business and scope. */
const getApplicationScope = async (req) => {
    const filter = { businessId: new mongoose.Types.ObjectId(req.user.businessId) };
    const counsellorIds = await getScopedCounsellorIds(req);
    if (counsellorIds) filter.counsellorId = { $in: counsellorIds };
    return filter;
};

/** Loads an application only if it is inside the user's scope; null otherwise. */
const findApplicationInScope = async (req, id) => {
    if (!mongoose.isValidObjectId(id)) return null;
    const scope = await getApplicationScope(req);
    return AdmissionApplication.findOne({ ...scope, _id: id });
};

/** Staff the user may assign applications to (active users only). */
const getAssignableCounsellors = async (req) => {
    const filter = { businessId: req.user.businessId, isActive: true, role: { $in: STAFF_ROLES } };
    const counsellorIds = await getScopedCounsellorIds(req);
    if (counsellorIds) filter._id = { $in: counsellorIds };
    return User.find(filter).select('name email role managerId').sort({ name: 1 });
};

/**
 * Checks that the user may assign an application to `counsellorId`.
 * Owner: any active staff. Manager: self or own salespeople. Salesperson: self only.
 */
const validateCounsellor = async (req, counsellorId) => {
    if (counsellorId === null || counsellorId === '') {
        return isAdmin(req)
            ? { counsellorId: null }
            : { status: 403, error: 'Only an admin can leave a student unassigned' };
    }

    if (!mongoose.isValidObjectId(counsellorId)) {
        return { status: 400, error: 'Invalid counsellor' };
    }

    const allowed = await getAssignableCounsellors(req);
    const match = allowed.find((u) => u._id.toString() === String(counsellorId));

    if (!match) {
        return req.user.role === 'SALESPERSON'
            ? { status: 403, error: 'Only an admin or manager can assign students to other staff' }
            : { status: 400, error: 'Counsellor not found or not in your team' };
    }

    return { counsellorId: match._id };
};

module.exports = {
    STAFF_ROLES,
    isAdmin,
    requireAdmissions,
    getScopedCounsellorIds,
    getApplicationScope,
    findApplicationInScope,
    getAssignableCounsellors,
    validateCounsellor,
};
