const mongoose = require('mongoose');
const Lead = require('../models/Leads');
const FollowUp = require('../models/FollowUp');
const Quotation = require('../models/Quotation');
const Business = require('../models/Business');
const { getLeadScope } = require('./leadController');
const { getFollowUpScope } = require('./followUpController');
const { getQuotationScope } = require('./quotationController');
const { can } = require('../services/access');
const { isValidTimeZone, zonedStartOfDay } = require('../services/admissions/time');

const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSION_DAYS = 90;
const NEGLECTED_DAYS = 7;
const EXPIRING_DAYS = 7;
const LIST_LIMIT = 5;
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

/** Start of the current calendar month in the viewer's timezone. */
const monthStart = (now, timeZone) => {
    const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
        .format(now)
        .split('-')
        .map(Number);
    return zonedStartOfDay(y, m, 1, timeZone);
};

/**
 * Open leads nobody is working: no follow-up scheduled, and neither edited nor
 * followed up for NEGLECTED_DAYS. Largest deals first.
 */
const neglectedLeads = async (leadScope, businessId, now) => {
    const cutoff = new Date(now - NEGLECTED_DAYS * DAY_MS);
    const stale = await Lead.find({ ...leadScope, status: { $in: OPEN_STATUSES }, updatedAt: { $lt: cutoff } })
        .select('customerName companyName status estimatedValue assignedTo updatedAt')
        .populate('assignedTo', 'name')
        .lean();
    const result = { count: 0, idleDays: NEGLECTED_DAYS, items: [] };
    if (!stale.length) return result;

    // Someone else's follow-up on the lead still counts as someone working it
    const busy = new Set(
        (
            await FollowUp.distinct('leadId', {
                businessId,
                leadId: { $in: stale.map((l) => l._id) },
                isArchived: { $ne: true },
                $or: [{ status: 'PENDING' }, { status: 'COMPLETED', completedAt: { $gte: cutoff } }],
            })
        ).map(String)
    );
    const neglected = stale
        .filter((l) => !busy.has(String(l._id)))
        .sort((x, y) => (y.estimatedValue || 0) - (x.estimatedValue || 0) || x.updatedAt - y.updatedAt);

    const top = neglected.slice(0, LIST_LIMIT);
    const lastDone = new Map(
        (
            await FollowUp.aggregate([
                { $match: { businessId: new mongoose.Types.ObjectId(String(businessId)), leadId: { $in: top.map((l) => l._id) }, status: 'COMPLETED' } },
                { $group: { _id: '$leadId', at: { $max: '$completedAt' } } },
            ])
        ).map((r) => [String(r._id), r.at])
    );

    result.count = neglected.length;
    result.items = top.map((l) => {
        const done = lastDone.get(String(l._id));
        const lastActivityAt = done && done > l.updatedAt ? done : l.updatedAt;
        return {
            id: l._id,
            name: l.customerName,
            company: l.companyName || '',
            value: l.estimatedValue || 0,
            status: l.status,
            statusLabel: STATUS_LABELS[l.status],
            assignedTo: l.assignedTo?.name ?? null,
            lastActivityAt,
            idleDays: Math.floor((now - lastActivityAt) / DAY_MS),
        };
    });
    return result;
};

/** Sum of grand totals per currency for quotations matching `match`. */
const totalsByCurrency = async (match) => {
    const rows = await Quotation.aggregate([
        { $match: match },
        { $group: { _id: '$currency', amount: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
    ]);
    return {
        count: rows.reduce((sum, r) => sum + r.count, 0),
        totals: rows.map((r) => ({ currency: r._id, amount: r.amount })),
    };
};

/** Sent quotations still awaiting an answer, the ones about to lapse, and this month's acceptances. */
const quotationFigures = async (req, now, timeZone) => {
    if (!can(req, 'quotations.view')) return null;
    const { scope } = await getQuotationScope(req);
    // validUntil filters out quotations the expiry job has not reached yet
    const awaitingMatch = { ...scope, status: 'SENT', validUntil: { $gte: now } };
    const soonMatch = { ...scope, status: 'SENT', validUntil: { $gte: now, $lt: new Date(now.getTime() + EXPIRING_DAYS * DAY_MS) } };

    const [awaiting, soonCount, soon, acceptedThisMonth] = await Promise.all([
        totalsByCurrency(awaitingMatch),
        Quotation.countDocuments(soonMatch),
        Quotation.find(soonMatch).select('quotationNumber customer.name grandTotal currency validUntil').sort({ validUntil: 1 }).limit(LIST_LIMIT).lean(),
        totalsByCurrency({ ...scope, status: 'ACCEPTED', acceptedAt: { $gte: monthStart(now, timeZone) } }),
    ]);

    return {
        awaiting,
        expiringSoon: {
            count: soonCount,
            withinDays: EXPIRING_DAYS,
            items: soon.map((q) => ({
                id: q._id,
                number: q.quotationNumber,
                customer: q.customer?.name || '',
                amount: q.grandTotal,
                currency: q.currency,
                validUntil: q.validUntil,
                daysLeft: Math.ceil((q.validUntil - now) / DAY_MS),
            })),
        },
        acceptedThisMonth,
    };
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

        const [recent, neglected, unassignedLeads, oldestOverdue, quotations] = await Promise.all([
            FollowUp.find({ ...followUpScope, status: 'COMPLETED', completedAt: { $ne: null } })
                .sort({ completedAt: -1 })
                .limit(5)
                .populate(leadPopulate),
            neglectedLeads(leadScope, req.user.businessId, now),
            // $and, not a spread: the scope may already restrict assignedTo
            Lead.countDocuments({ $and: [leadScope, { status: { $in: OPEN_STATUSES }, assignedTo: null }] }),
            FollowUp.findOne({ ...followUpScope, status: 'PENDING', scheduledAt: { $lt: now } }).sort({ scheduledAt: 1 }).select('scheduledAt').lean(),
            quotationFigures(req, now, timeZone),
        ]);

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
                attention: {
                    overdueFollowUps: { count: overdueCount, oldestAt: oldestOverdue?.scheduledAt ?? null },
                    neglectedLeads: neglected,
                    unassignedLeads,
                },
                quotations,
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getSummary, todayRange };
