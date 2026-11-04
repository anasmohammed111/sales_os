const Lead = require('../models/Leads');
const FollowUp = require('../models/FollowUp');
const Business = require('../models/Business');
const { getLeadScope } = require('./leadController');
const { getFollowUpScope } = require('./followUpController');
const { isValidTimeZone, zonedStartOfDay } = require('../services/admissions/time');

const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSION_DAYS = 90;
const OPEN_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTATION_SENT', 'NEGOTIATION'];
const QUALIFIED_STATUSES = ['QUALIFIED', 'QUOTATION_SENT', 'NEGOTIATION'];
const STATUS_LABELS = {
    NEW: 'New',
    CONTACTED: 'Contacted',
    QUALIFIED: 'Qualified',
    QUOTATION_SENT: 'Quotation sent',
    NEGOTIATION: 'Negotiation',
};

/** [start, end) of today in the viewer's timezone. */
const todayRange = (now, timeZone) => {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(now)
        .split('-')
        .map(Number);
    const start = zonedStartOfDay(y, m, d, timeZone);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const end = zonedStartOfDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
    return { start, end };
};

/** Leads whose most recent move to `status` happened since `since`. */
const closedSince = (leads, status, since) =>
    leads.filter((lead) => {
        if (lead.status !== status) return false;
        const last = [...(lead.statusHistory || [])].reverse().find((h) => h.toStatus === status);
        return last && last.changedAt >= since;
    });

const queueItem = (f, now) => ({
    id: f._id,
    leadId: f.leadId?._id ?? f.leadId,
    leadName: f.leadId?.customerName || 'Lead',
    company: f.leadId?.companyName || '',
    dealValue: f.leadId?.estimatedValue ?? 0,
    type: f.type,
    title: f.title || '',
    priority: f.priority || 'MEDIUM',
    status: f.status,
    scheduledAt: f.scheduledAt,
    completedAt: f.completedAt,
    notes: f.notes,
    outcome: f.outcome,
    isOverdue: f.status === 'PENDING' && f.scheduledAt < now,
    applicationId: f.applicationId || null,
});

/**
 * GET /api/dashboard/summary?tz=Area/City
 * Home screen numbers, scoped exactly like the Leads and Follow-ups pages.
 */
const getSummary = async (req, res, next) => {
    try {
        const timeZone = typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : 'UTC';
        if (!isValidTimeZone(timeZone)) {
            return res.status(400).json({ success: false, message: 'Unknown timezone' });
        }

        const now = new Date();
        const { start, end } = todayRange(now, timeZone);
        const followUpScope = await getFollowUpScope(req);
        const leadScope = await getLeadScope(req);
        const leadPopulate = { path: 'leadId', select: 'customerName companyName estimatedValue' };

        const pendingFilter = { ...followUpScope, status: 'PENDING', scheduledAt: { $lt: end } };
        const completedFilter = { ...followUpScope, status: 'COMPLETED', completedAt: { $gte: start, $lt: end } };

        // Counts come from the database; the queue below is capped for display
        const [pendingCount, completedCount, overdueCount, urgentCount] = await Promise.all([
            FollowUp.countDocuments(pendingFilter),
            FollowUp.countDocuments(completedFilter),
            FollowUp.countDocuments({ ...pendingFilter, scheduledAt: { $lt: now } }),
            FollowUp.countDocuments({ ...pendingFilter, $or: [{ scheduledAt: { $lt: now } }, { priority: 'HIGH' }] }),
        ]);

        const [pendingDue, completedToday, leads, business] = await Promise.all([
            FollowUp.find(pendingFilter)
                .sort({ scheduledAt: 1 })
                .limit(200)
                .populate(leadPopulate),
            FollowUp.find(completedFilter)
                .sort({ completedAt: -1 })
                .limit(100)
                .populate(leadPopulate),
            Lead.find(leadScope).select('status estimatedValue statusHistory.toStatus statusHistory.changedAt').lean(),
            Business.findById(req.user.businessId).select('currency'),
        ]);

        const open = leads.filter((l) => OPEN_STATUSES.includes(l.status));
        const openValue = open.reduce((sum, l) => sum + (l.estimatedValue || 0), 0);
        const wonWeek = closedSince(leads, 'WON', new Date(now - 7 * DAY_MS));
        const since = new Date(now - CONVERSION_DAYS * DAY_MS);
        const won = closedSince(leads, 'WON', since).length;
        const lost = closedSince(leads, 'LOST', since).length;

        const recent = await FollowUp.find({ ...followUpScope, status: 'COMPLETED', completedAt: { $ne: null } })
            .sort({ completedAt: -1 })
            .limit(5)
            .populate(leadPopulate);

        return res.json({
            success: true,
            data: {
                currency: business?.currency || 'USD',
                timezone: timeZone,
                followUpsToday: {
                    total: pendingCount + completedCount,
                    pending: pendingCount,
                    completed: completedCount,
                    overdue: overdueCount,
                    urgent: urgentCount,
                },
                queue: [...pendingDue, ...completedToday].map((f) => queueItem(f, now)),
                pipeline: {
                    openCount: open.length,
                    openValue,
                    averageValue: open.length ? Math.round(openValue / open.length) : 0,
                    qualifiedCount: open.filter((l) => QUALIFIED_STATUSES.includes(l.status)).length,
                    byStatus: OPEN_STATUSES.map((status) => {
                        const inStatus = open.filter((l) => l.status === status);
                        return {
                            status,
                            label: STATUS_LABELS[status],
                            count: inStatus.length,
                            value: inStatus.reduce((sum, l) => sum + (l.estimatedValue || 0), 0),
                        };
                    }),
                },
                wonLast7Days: { count: wonWeek.length, value: wonWeek.reduce((sum, l) => sum + (l.estimatedValue || 0), 0) },
                conversion: {
                    won,
                    lost,
                    rate: won + lost ? won / (won + lost) : null,
                    definition: `Leads won out of all leads won or lost in the last ${CONVERSION_DAYS} days.`,
                },
                recentCompletions: recent.map((f) => queueItem(f, now)),
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getSummary, todayRange };
