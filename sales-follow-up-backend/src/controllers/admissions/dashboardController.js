const mongoose = require('mongoose');
const AdmissionApplication = require('../../models/AdmissionApplication');
const AdmissionFee = require('../../models/AdmissionFee');
const { getAllStages } = require('../../services/admissions/configService');
const { buildApplicationQuery, toDate } = require('../../services/admissions/filters');
const { formatMinor } = require('../../services/admissions/money');
const { formatDate, zonedMonthRange } = require('../../services/admissions/time');

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const DIMENSIONS = ['intakeYear', 'intakeMonth', 'counsellorId', 'universityId', 'studyLevel'];

/** Reporting period: ?month=YYYY-MM (in the module timezone), ?from/?to, or the last 12 months. */
const periodOf = (query, timeZone, now) => {
    const month = /^(\d{4})-(\d{2})$/.exec(query.month || '');
    if (month) {
        const [from, to] = zonedMonthRange(Number(month[1]), Number(month[2]), timeZone);
        return { from, to };
    }
    return {
        from: toDate(query.from) || new Date(now.getTime() - YEAR_MS),
        to: toDate(query.to) || now,
    };
};

/**
 * Admissions dashboard. Every metric is counted with the same filter builder
 * the Students list uses, and returns that filter as `query`, so a card's
 * number always matches the list it links to — within the viewer's scope.
 */
const getDashboard = async (req, res, next) => {
    try {
        const config = req.admissionsConfig;
        const now = new Date();
        const { from, to } = periodOf(req.query, config.timezone, now);

        const dims = {};
        for (const key of DIMENSIONS) {
            if (req.query[key]) dims[key] = String(req.query[key]);
        }

        const createdRange = { createdFrom: from.toISOString(), createdTo: to.toISOString() };
        const visaRange = { visaFrom: from.toISOString(), visaTo: to.toISOString() };

        const metricQueries = {
            newLeads: { ...dims, status: 'ALL', ...createdRange },
            active: { ...dims },
            overdueFollowUps: { ...dims, overdue: '1' },
            stuck: { ...dims, stuck: '1' },
            needsReview: { ...dims, needsReview: '1' },
            visasApproved: { ...dims, status: 'ALL', visaOutcome: 'APPROVED', ...visaRange },
            visasRejected: { ...dims, status: 'ALL', visaOutcome: 'REJECTED', ...visaRange },
        };

        const count = async (query) => {
            const { filter } = await buildApplicationQuery(req, query, config, now);
            return AdmissionApplication.countDocuments(filter);
        };

        const metrics = {};
        for (const [name, query] of Object.entries(metricQueries)) {
            metrics[name] = { value: await count(query), query };
        }

        // Per-stage counts for active applications
        const { filter: activeFilter } = await buildApplicationQuery(req, dims, config, now);
        const { filter: stuckFilter } = await buildApplicationQuery(req, metricQueries.stuck, config, now);
        const [stageCounts, stuckCounts] = await Promise.all([
            AdmissionApplication.aggregate([{ $match: activeFilter }, { $group: { _id: '$currentStageKey', n: { $sum: 1 } } }]),
            AdmissionApplication.aggregate([{ $match: stuckFilter }, { $group: { _id: '$currentStageKey', n: { $sum: 1 } } }]),
        ]);
        const countOf = (rows, key) => rows.find((r) => r._id === key)?.n || 0;

        const stages = getAllStages(config)
            .map((stage) => ({
                key: stage.key,
                name: stage.name,
                order: stage.order,
                isArchived: stage.isArchived,
                count: countOf(stageCounts, stage.key),
                stuck: countOf(stuckCounts, stage.key),
                query: { ...dims, stage: stage.key },
            }))
            .filter((s) => !s.isArchived || s.count > 0);

        // Outstanding fees per currency across every application in scope (any status)
        const { filter: allFilter } = await buildApplicationQuery(req, { ...dims, status: 'ALL' }, config, now);
        const ids = (await AdmissionApplication.find(allFilter).select('_id').lean()).map((a) => a._id);
        const feeRows = await AdmissionFee.aggregate([
            {
                $match: {
                    businessId: new mongoose.Types.ObjectId(req.user.businessId),
                    applicationId: { $in: ids },
                    isArchived: { $ne: true },
                },
            },
            {
                $group: {
                    _id: '$currency',
                    dueMinor: { $sum: '$amountDueMinor' },
                    paidMinor: { $sum: '$paidMinor' },
                    outstandingMinor: { $sum: '$outstandingMinor' },
                    overdueMinor: {
                        $sum: {
                            $cond: [
                                { $and: [{ $gt: ['$outstandingMinor', 0] }, { $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] },
                                '$outstandingMinor',
                                0,
                            ],
                        },
                    },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const cohort = metrics.newLeads.value;
        const approved = await count({ ...metricQueries.newLeads, visaOutcome: 'APPROVED' });
        const tz = config.timezone;

        return res.json({
            success: true,
            data: {
                period: { from, to, timezone: tz },
                metrics,
                stages,
                outstandingByCurrency: feeRows
                    .filter((r) => r.dueMinor > 0)
                    .map((r) => ({
                        currency: r._id,
                        due: formatMinor(r.dueMinor),
                        paid: formatMinor(r.paidMinor),
                        outstanding: formatMinor(r.outstandingMinor),
                        overdue: formatMinor(r.overdueMinor),
                        outstandingMinor: r.outstandingMinor,
                        overdueMinor: r.overdueMinor,
                    })),
                conversion: {
                    cohort,
                    approved,
                    rate: cohort ? approved / cohort : null,
                    definition: `Of the ${cohort} students added between ${formatDate(from, tz)} and ${formatDate(to, tz)}, ${approved} ${
                        approved === 1 ? 'has' : 'have'
                    } an approved visa.`,
                    query: { ...metricQueries.newLeads, visaOutcome: 'APPROVED' },
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getDashboard };
