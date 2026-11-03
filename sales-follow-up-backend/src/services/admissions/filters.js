const mongoose = require('mongoose');
const { getApplicationScope } = require('./access');
const { getAllStages } = require('./configService');
const { APPLICATION_STATUSES, STUDY_LEVELS, VISA_OUTCOMES, PAYMENT_STATUSES } = require('../../models/AdmissionApplication');

const DAY_MS = 24 * 60 * 60 * 1000;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isTrue = (value) => value === true || value === 'true' || value === '1';

const toInt = (value) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
};

const toDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

/** Stuck = active and in the current stage longer than that stage's threshold. */
const stuckCondition = (config, now) => ({
    status: 'ACTIVE',
    $or: getAllStages(config).map((stage) => ({
        currentStageKey: stage.key,
        stageEnteredAt: { $lt: new Date(now.getTime() - stage.stuckThresholdDays * DAY_MS) },
    })),
});

/**
 * Mongo filter for the applications list, exports and dashboard links.
 * Always starts from the user's scope, so a filter can only narrow it.
 * `status` defaults to ACTIVE; pass status=ALL for every status.
 */
const buildApplicationQuery = async (req, query = {}, config, now = new Date()) => {
    const and = [await getApplicationScope(req)];

    const status = typeof query.status === 'string' ? query.status.toUpperCase() : '';
    if (!status) and.push({ status: 'ACTIVE' });
    else if (APPLICATION_STATUSES.includes(status)) and.push({ status });

    const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
    if (search) {
        const pattern = { $regex: escapeRegex(search), $options: 'i' };
        const or = [{ 'student.name': pattern }, { 'student.email': pattern }, { 'student.phone': pattern }];
        const digits = search.replace(/\D/g, '');
        if (digits.length >= 3) or.push({ 'student.phoneDigits': { $regex: escapeRegex(digits) } });
        and.push({ $or: or });
    }

    if (typeof query.stage === 'string' && query.stage) and.push({ currentStageKey: query.stage });

    const intakeYear = toInt(query.intakeYear);
    if (intakeYear) and.push({ intakeYear });
    const intakeMonth = toInt(query.intakeMonth);
    if (intakeMonth) and.push({ intakeMonth });

    if (STUDY_LEVELS.includes(query.studyLevel)) and.push({ studyLevel: query.studyLevel });

    if (query.counsellorId === 'UNASSIGNED') and.push({ counsellorId: null });
    else if (mongoose.isValidObjectId(query.counsellorId)) {
        and.push({ counsellorId: new mongoose.Types.ObjectId(query.counsellorId) });
    }

    if (mongoose.isValidObjectId(query.universityId)) {
        const id = new mongoose.Types.ObjectId(query.universityId);
        and.push({ $or: [{ 'finalChoice.universityId': id }, { 'shortlist.universityId': id }] });
    }

    if (isTrue(query.overdue)) and.push({ status: 'ACTIVE', nextFollowUpAt: { $lt: now } });
    if (isTrue(query.stuck)) and.push(stuckCondition(config, now));
    if (isTrue(query.needsReview)) and.push({ needsReview: true });

    const paymentStatus = typeof query.paymentStatus === 'string' ? query.paymentStatus.toUpperCase() : '';
    if (paymentStatus === 'OVERDUE') and.push({ 'paymentSummary.nextDueAt': { $lt: now } });
    else if (paymentStatus === 'OUTSTANDING') {
        and.push({ 'paymentSummary.status': { $in: ['UNPAID', 'PARTIALLY_PAID'] } });
    } else if (PAYMENT_STATUSES.includes(paymentStatus)) and.push({ 'paymentSummary.status': paymentStatus });

    if (VISA_OUTCOMES.includes(query.visaOutcome)) and.push({ 'visa.outcome': query.visaOutcome });

    const createdFrom = toDate(query.createdFrom);
    const createdTo = toDate(query.createdTo);
    if (createdFrom || createdTo) {
        and.push({ createdAt: { ...(createdFrom && { $gte: createdFrom }), ...(createdTo && { $lte: createdTo }) } });
    }

    const visaFrom = toDate(query.visaFrom);
    const visaTo = toDate(query.visaTo);
    if (visaFrom || visaTo) {
        and.push({ 'visa.outcomeAt': { ...(visaFrom && { $gte: visaFrom }), ...(visaTo && { $lte: visaTo }) } });
    }

    const sorts = {
        name: { 'student.name': 1 },
        followUp: { nextFollowUpAt: 1, createdAt: -1 },
        stage: { stageEnteredAt: 1 },
        recent: { createdAt: -1 },
    };

    return { filter: { $and: and }, sort: sorts[query.sort] || sorts.recent };
};

module.exports = { DAY_MS, escapeRegex, buildApplicationQuery, stuckCondition, toDate };
