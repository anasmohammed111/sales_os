const mongoose = require('mongoose');
const Business = require('../../models/Business');
const User = require('../../models/User');
const AdmissionApplication = require('../../models/AdmissionApplication');
const { ensureConfig } = require('./configService');
const access = require('../access');

const STAFF_ROLES = ['OWNER', 'SALES_MANAGER', 'SALESPERSON'];

/**
 * Whether this person runs admissions for the whole business: they can change
 * admissions settings. Specific actions check their own permission instead.
 */
const isAdmin = (req) => access.can(req, 'admissions.settings');

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
 * Counsellor ids whose applications the user may see (their admissions data
 * scope). Returns null for everyone in the business.
 */
const getScopedCounsellorIds = async (req) => {
    if (!access.can(req, 'admissions.view')) return [];
    return access.visibleUserIds(req, 'admissions');
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
const getAssignableCounsellors = async (req) => access.assignablePeople(req, 'admissions');

/**
 * Checks that the user may assign an application to `counsellorId`:
 * themselves, or anyone in their admissions scope with the "assign" permission.
 */
const validateCounsellor = async (req, counsellorId) => {
    if (counsellorId === null || counsellorId === '') {
        return (await access.canAssignTo(req, 'admissions', null))
            ? { counsellorId: null }
            : { status: 403, error: 'You cannot leave a student unassigned' };
    }

    if (!mongoose.isValidObjectId(counsellorId)) {
        return { status: 400, error: 'Invalid counsellor' };
    }

    const counsellor = await User.findOne({ _id: counsellorId, businessId: req.user.businessId, isActive: true })
        .select('_id')
        .lean();
    if (!counsellor) return { status: 400, error: 'Counsellor not found or not in your team' };

    if (!(await access.canAssignTo(req, 'admissions', counsellor._id))) {
        return access.can(req, 'admissions.assign') && access.scopeOf(req, 'admissions') !== 'own'
            ? { status: 400, error: 'Counsellor not found or not in your team' }
            : { status: 403, error: 'Only an admin or manager can assign students to other staff' };
    }

    return { counsellorId: counsellor._id };
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
