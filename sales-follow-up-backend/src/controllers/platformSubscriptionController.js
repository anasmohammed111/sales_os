const mongoose = require('mongoose');
const Business = require('../models/Business');
const Plan = require('../models/Plan');
const { PLAN_STATUSES, PLAN_MODULES } = require('../models/Plan');
const Subscription = require('../models/Subscription');
const { SUBSCRIPTION_STATUSES, BILLING_CYCLES } = require('../models/Subscription');
const { businessStatus } = require('../services/businessStatus');
const { audit } = require('../services/platform');

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validId = (value) => mongoose.isValidObjectId(value);
const paging = (query, defaultLimit = 25) => {
    const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1), 100);
    const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
    return { limit, page, skip: (page - 1) * limit };
};
const dateValue = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};
const addCycle = (start, cycle) => {
    const date = new Date(start);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    if (cycle === 'YEARLY') date.setUTCFullYear(date.getUTCFullYear() + 1);
    else date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date;
};
const addDays = (start, days) => new Date(new Date(start).getTime() + days * 86400000);

const snapshotOf = (plan) => ({
    key: plan.key,
    name: plan.name,
    currency: plan.currency,
    prices: { monthly: plan.prices.monthly, yearly: plan.prices.yearly },
    trialDays: plan.trialDays || 0,
    limits: {
        users: plan.limits?.users || 0,
        leads: plan.limits?.leads || 0,
        students: plan.limits?.students || 0,
        storageMb: plan.limits?.storageMb || 0,
    },
    modules: [...(plan.modules || [])],
});

const planView = (plan) => ({
    id: String(plan._id),
    key: plan.key,
    name: plan.name,
    description: plan.description || '',
    currency: plan.currency,
    prices: { monthly: plan.prices.monthly, yearly: plan.prices.yearly },
    trialDays: plan.trialDays || 0,
    limits: {
        users: plan.limits?.users || 0,
        leads: plan.limits?.leads || 0,
        students: plan.limits?.students || 0,
        storageMb: plan.limits?.storageMb || 0,
    },
    modules: [...(plan.modules || [])],
    status: plan.status,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
});

const subscriptionView = (subscription) => {
    const business = subscription.businessId && subscription.businessId.businessName ? subscription.businessId : null;
    return {
        id: String(subscription._id),
        workspace: business
            ? {
                  id: String(business._id),
                  businessName: business.businessName,
                  email: business.email || '',
                  status: businessStatus(business),
              }
            : { id: String(subscription.businessId), businessName: '', email: '', status: 'ARCHIVED' },
        planId: String(subscription.planId?._id || subscription.planId),
        plan: subscription.planSnapshot,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        amountMinor: subscription.amountMinor,
        currency: subscription.currency,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === true,
        cancelledAt: subscription.cancelledAt,
        notes: subscription.notes || '',
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
    };
};

const readPrices = (body, current = null) => {
    const source = body.prices || {};
    const monthly = source.monthly ?? current?.monthly;
    const yearly = source.yearly ?? current?.yearly;
    if (!Number.isInteger(monthly) || monthly < 0 || !Number.isInteger(yearly) || yearly < 0) return null;
    return { monthly, yearly };
};

const readLimits = (body, current = {}) => {
    const source = body.limits || {};
    const limits = {};
    for (const key of ['users', 'leads', 'students', 'storageMb']) {
        const value = source[key] ?? current?.[key] ?? 0;
        if (!Number.isInteger(value) || value < 0) return null;
        limits[key] = value;
    }
    return limits;
};

const listPlans = async (req, res, next) => {
    try {
        const filter = {};
        const status = String(req.query.status || '').toUpperCase();
        if (PLAN_STATUSES.includes(status)) filter.status = status;
        const plans = await Plan.find(filter).sort({ status: 1, name: 1 });
        return res.json({ success: true, data: { items: plans.map(planView) } });
    } catch (error) {
        next(error);
    }
};

const createPlan = async (req, res, next) => {
    try {
        const body = req.body || {};
        const key = typeof body.key === 'string' ? body.key.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
        const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
        const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
        const prices = readPrices(body);
        const limits = readLimits(body);
        const trialDays = Number(body.trialDays ?? 0);
        const modules = Array.isArray(body.modules) ? [...new Set(body.modules.map((m) => String(m).toLowerCase()))] : ['crm'];
        if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(key)) return fail(res, 400, 'Plan key must use 2–40 letters, numbers or underscores');
        if (!name) return fail(res, 400, 'Enter a plan name');
        if (!/^[A-Z]{3}$/.test(currency)) return fail(res, 400, 'Currency must be a 3-letter code');
        if (!prices) return fail(res, 400, 'Monthly and yearly prices must be non-negative whole minor units');
        if (!limits) return fail(res, 400, 'Plan limits must be non-negative whole numbers');
        if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) return fail(res, 400, 'Trial days must be between 0 and 365');
        if (modules.some((m) => !PLAN_MODULES.includes(m))) return fail(res, 400, `Modules can only be: ${PLAN_MODULES.join(', ')}`);
        if (await Plan.exists({ key })) return fail(res, 409, 'A plan with that key already exists');

        const plan = await Plan.create({
            key,
            name,
            description,
            currency,
            prices,
            trialDays,
            limits,
            modules,
            createdBy: req.platformAdmin.id,
            updatedBy: req.platformAdmin.id,
        });
        await audit(req, { platformAdminId: req.platformAdmin.id, action: 'PLAN_CREATED', details: { planId: String(plan._id), key, name } });
        return res.status(201).json({ success: true, data: { plan: planView(plan) } });
    } catch (error) {
        if (error.code === 11000) return fail(res, 409, 'A plan with that key already exists');
        next(error);
    }
};

const updatePlan = async (req, res, next) => {
    try {
        if (!validId(req.params.id)) return fail(res, 404, 'Plan not found');
        const plan = await Plan.findById(req.params.id);
        if (!plan) return fail(res, 404, 'Plan not found');
        const body = req.body || {};
        const allowed = new Set(['name', 'description', 'currency', 'prices', 'trialDays', 'limits', 'modules', 'status']);
        if (Object.keys(body).some((key) => !allowed.has(key))) return fail(res, 400, 'The plan key cannot be changed');

        const before = planView(plan);
        if (body.name !== undefined) {
            const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
            if (!name) return fail(res, 400, 'Enter a plan name');
            plan.name = name;
        }
        if (body.description !== undefined) plan.description = String(body.description || '').trim().slice(0, 500);
        if (body.currency !== undefined) {
            const currency = String(body.currency).trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency)) return fail(res, 400, 'Currency must be a 3-letter code');
            plan.currency = currency;
        }
        if (body.prices !== undefined) {
            const prices = readPrices(body, plan.prices);
            if (!prices) return fail(res, 400, 'Monthly and yearly prices must be non-negative whole minor units');
            plan.prices = prices;
        }
        if (body.limits !== undefined) {
            const limits = readLimits(body, plan.limits);
            if (!limits) return fail(res, 400, 'Plan limits must be non-negative whole numbers');
            plan.limits = limits;
        }
        if (body.trialDays !== undefined) {
            const trialDays = Number(body.trialDays);
            if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) return fail(res, 400, 'Trial days must be between 0 and 365');
            plan.trialDays = trialDays;
        }
        if (body.modules !== undefined) {
            if (!Array.isArray(body.modules)) return fail(res, 400, 'Modules must be a list');
            const modules = [...new Set(body.modules.map((m) => String(m).toLowerCase()))];
            if (modules.some((m) => !PLAN_MODULES.includes(m))) return fail(res, 400, `Modules can only be: ${PLAN_MODULES.join(', ')}`);
            plan.modules = modules;
        }
        if (body.status !== undefined) {
            const status = String(body.status).toUpperCase();
            if (!PLAN_STATUSES.includes(status)) return fail(res, 400, 'Choose an active or archived plan status');
            plan.status = status;
        }
        plan.updatedBy = req.platformAdmin.id;
        await plan.save();
        const after = planView(plan);
        await audit(req, {
            platformAdminId: req.platformAdmin.id,
            action: 'PLAN_UPDATED',
            details: { planId: String(plan._id), key: plan.key, before, after },
        });
        return res.json({ success: true, data: { plan: after } });
    } catch (error) {
        next(error);
    }
};

const listSubscriptions = async (req, res, next) => {
    try {
        const { limit, page, skip } = paging(req.query);
        const filter = {};
        const status = String(req.query.status || '').toUpperCase();
        const billingCycle = String(req.query.billingCycle || '').toUpperCase();
        const plan = String(req.query.plan || '').trim().toUpperCase();
        if (SUBSCRIPTION_STATUSES.includes(status)) filter.status = status;
        if (BILLING_CYCLES.includes(billingCycle)) filter.billingCycle = billingCycle;
        if (plan) filter['planSnapshot.key'] = plan;
        if (req.query.businessId) {
            if (!validId(req.query.businessId)) return fail(res, 400, 'Invalid businessId');
            filter.businessId = req.query.businessId;
        }
        const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
        if (search) {
            const pattern = new RegExp(escapeRegex(search), 'i');
            const companies = await Business.find({ $or: [{ businessName: pattern }, { email: pattern }] }).select('_id');
            const ids = companies.map((company) => company._id);
            filter.businessId = filter.businessId ? { $in: ids.filter((id) => String(id) === String(req.query.businessId)) } : { $in: ids };
        }
        const [items, total] = await Promise.all([
            Subscription.find(filter)
                .populate('businessId', 'businessName email status isActive')
                .populate('planId', 'key name status')
                .sort({ updatedAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit),
            Subscription.countDocuments(filter),
        ]);
        return res.json({ success: true, data: { items: items.map(subscriptionView), total, page, limit } });
    } catch (error) {
        next(error);
    }
};

const TRANSITIONS = {
    TRIALING: new Set(['ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED']),
    ACTIVE: new Set(['PAST_DUE', 'CANCELLED', 'EXPIRED']),
    PAST_DUE: new Set(['ACTIVE', 'CANCELLED', 'EXPIRED']),
    CANCELLED: new Set(['ACTIVE', 'TRIALING']),
    EXPIRED: new Set(['ACTIVE', 'TRIALING']),
};

// Plan modules that are switches on the company ('crm' is always on)
const SWITCHED_MODULES = ['admissions'];
const IN_USE = ['TRIALING', 'ACTIVE', 'PAST_DUE'];

/**
 * The company gets the modules its plan includes. Moving to a plan without a
 * module switches it off (its data is kept); other edits never switch one off,
 * so a module turned on by hand under Modules survives a note or date change.
 */
const applyPlanModules = async (req, business, { modules, planKey, planChanged, status, reason }) => {
    const changes = {};
    for (const feature of SWITCHED_MODULES) {
        const from = business.features?.[feature] === true;
        const included = modules.includes(feature);
        const to = included && IN_USE.includes(status) ? true : planChanged && !included ? false : from;
        if (to !== from) changes[feature] = { from, to };
    }
    for (const [feature, change] of Object.entries(changes)) {
        business.set(`features.${feature}`, change.to);
        await audit(req, {
            platformAdminId: req.platformAdmin.id,
            action: 'FEATURE_CHANGED',
            businessId: business._id,
            reason,
            details: { feature, ...change, source: 'subscription', planKey },
        });
    }
    if (Object.keys(changes).length) await business.save();
    return changes;
};

const saveSubscription = async (req, res, next) => {
    try {
        if (!validId(req.params.id)) return fail(res, 404, 'Company not found');
        const business = await Business.findById(req.params.id).select('businessName email status isActive features');
        if (!business) return fail(res, 404, 'Company not found');
        const body = req.body || {};
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
        if (reason.length < 5) return fail(res, 400, 'Give a reason or change note (at least 5 characters)');

        const existing = await Subscription.findOne({ businessId: business._id });
        let plan;
        if (body.planId !== undefined) {
            if (!validId(body.planId)) return fail(res, 400, 'Choose a valid plan');
            plan = await Plan.findById(body.planId);
        } else if (existing) {
            plan = await Plan.findById(existing.planId);
        }
        if (!plan) return fail(res, 400, 'Choose a plan');
        if (plan.status !== 'ACTIVE' && (!existing || String(existing.planId) !== String(plan._id))) {
            return fail(res, 409, 'Archived plans cannot be assigned to new subscriptions');
        }

        const billingCycle = String(body.billingCycle || existing?.billingCycle || 'MONTHLY').toUpperCase();
        if (!BILLING_CYCLES.includes(billingCycle)) return fail(res, 400, 'Choose monthly or yearly billing');
        const defaultStatus = plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE';
        const status = String(body.status || existing?.status || defaultStatus).toUpperCase();
        if (!SUBSCRIPTION_STATUSES.includes(status)) return fail(res, 400, 'Choose a valid subscription status');
        if (existing && status !== existing.status && !TRANSITIONS[existing.status].has(status)) {
            return fail(res, 409, `A ${existing.status.toLowerCase()} subscription cannot move directly to ${status.toLowerCase()}`);
        }
        if (body.cancelAtPeriodEnd !== undefined && typeof body.cancelAtPeriodEnd !== 'boolean') {
            return fail(res, 400, 'cancelAtPeriodEnd must be true or false');
        }

        const requestedStart = dateValue(body.currentPeriodStart);
        const requestedEnd = dateValue(body.currentPeriodEnd);
        const requestedTrialEnd = dateValue(body.trialEndsAt);
        if (requestedStart === undefined || requestedEnd === undefined || requestedTrialEnd === undefined) return fail(res, 400, 'Enter valid subscription dates');

        const now = new Date();
        let periodStart = requestedStart || existing?.currentPeriodStart || now;
        let trialEndsAt = requestedTrialEnd ?? existing?.trialEndsAt ?? null;
        let periodEnd = requestedEnd || existing?.currentPeriodEnd || null;
        const planChanged = !existing || String(existing.planId) !== String(plan._id);
        const cycleChanged = existing && existing.billingCycle !== billingCycle;
        const startingPaidPeriod = existing && ['TRIALING', 'CANCELLED', 'EXPIRED'].includes(existing.status) && status === 'ACTIVE';

        if (status === 'TRIALING' && (!trialEndsAt || planChanged)) trialEndsAt = addDays(now, plan.trialDays || 14);
        if (!existing || planChanged || cycleChanged || startingPaidPeriod) {
            periodStart = requestedStart || now;
            periodEnd = requestedEnd || (status === 'TRIALING' && trialEndsAt ? trialEndsAt : addCycle(periodStart, billingCycle));
        } else if (!periodEnd) {
            periodEnd = addCycle(periodStart, billingCycle);
        }
        if (periodEnd <= periodStart) return fail(res, 400, 'The period end must be after the period start');
        if (status === 'TRIALING' && (!trialEndsAt || trialEndsAt <= periodStart)) return fail(res, 400, 'The trial end must be after the period start');

        const cancelAtPeriodEnd = status === 'CANCELLED' ? false : body.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false;
        const notes = body.notes === undefined ? existing?.notes || '' : String(body.notes || '').trim().slice(0, 1000);
        // Keep the commercial terms already assigned to this customer when
        // the catalog plan is edited. A different plan creates a new snapshot.
        const commercialSnapshot = planChanged ? snapshotOf(plan) : existing.planSnapshot.toObject();
        const amountMinor = billingCycle === 'YEARLY' ? commercialSnapshot.prices.yearly : commercialSnapshot.prices.monthly;
        const beforeStatus = existing?.status || null;
        const beforePlanKey = existing?.planSnapshot?.key || null;
        const action = existing ? 'UPDATED' : 'CREATED';
        const history = {
            action,
            fromStatus: beforeStatus,
            toStatus: status,
            fromPlanKey: beforePlanKey,
            toPlanKey: plan.key,
            reason,
            by: req.platformAdmin.id,
            at: now,
        };

        let subscription;
        if (existing) {
            existing.set({
                planId: plan._id,
                planSnapshot: commercialSnapshot,
                status,
                billingCycle,
                amountMinor,
                currency: commercialSnapshot.currency,
                trialEndsAt,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                cancelAtPeriodEnd,
                cancelledAt: status === 'CANCELLED' ? now : null,
                notes,
                updatedBy: req.platformAdmin.id,
            });
            existing.history.push(history);
            subscription = await existing.save();
        } else {
            subscription = await Subscription.create({
                businessId: business._id,
                planId: plan._id,
                planSnapshot: commercialSnapshot,
                status,
                billingCycle,
                amountMinor,
                currency: commercialSnapshot.currency,
                trialEndsAt: status === 'TRIALING' ? trialEndsAt : null,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                cancelAtPeriodEnd,
                cancelledAt: status === 'CANCELLED' ? now : null,
                notes,
                updatedBy: req.platformAdmin.id,
                history: [history],
            });
        }

        await audit(req, {
            platformAdminId: req.platformAdmin.id,
            action: existing ? 'SUBSCRIPTION_UPDATED' : 'SUBSCRIPTION_CREATED',
            businessId: business._id,
            reason,
            details: {
                subscriptionId: String(subscription._id),
                fromStatus: beforeStatus,
                toStatus: status,
                fromPlanKey: beforePlanKey,
                toPlanKey: plan.key,
                billingCycle,
                amountMinor,
                currency: commercialSnapshot.currency,
                cancelAtPeriodEnd,
            },
        });
        const modulesChanged = await applyPlanModules(req, business, {
            modules: commercialSnapshot.modules || [],
            planKey: plan.key,
            planChanged,
            status,
            reason,
        });
        await subscription.populate('businessId', 'businessName email status isActive');
        await subscription.populate('planId', 'key name status');
        return res
            .status(existing ? 200 : 201)
            .json({ success: true, data: { subscription: subscriptionView(subscription), modulesChanged } });
    } catch (error) {
        if (error.code === 11000) return fail(res, 409, 'This company already has a subscription');
        next(error);
    }
};

const getDashboard = async (req, res, next) => {
    try {
        const [businesses, subscriptions] = await Promise.all([
            Business.find().select('businessName email status isActive createdAt'),
            Subscription.find()
                .populate('businessId', 'businessName email status isActive')
                .populate('planId', 'key name status')
                .sort({ updatedAt: -1 }),
        ]);
        const statusCounts = Object.fromEntries(SUBSCRIPTION_STATUSES.map((status) => [status, 0]));
        const planCounts = new Map();
        const mrr = new Map();
        for (const subscription of subscriptions) {
            statusCounts[subscription.status] += 1;
            const planKey = subscription.planSnapshot?.key || 'UNKNOWN';
            const planName = subscription.planSnapshot?.name || 'Unknown plan';
            const planEntry = planCounts.get(planKey) || { key: planKey, name: planName, count: 0 };
            planEntry.count += 1;
            planCounts.set(planKey, planEntry);
            if (['ACTIVE', 'PAST_DUE'].includes(subscription.status)) {
                const monthly = subscription.billingCycle === 'YEARLY' ? Math.round(subscription.amountMinor / 12) : subscription.amountMinor;
                mrr.set(subscription.currency, (mrr.get(subscription.currency) || 0) + monthly);
            }
        }
        const thirtyDaysAgo = Date.now() - 30 * 86400000;
        const activeCompanies = businesses.filter((business) => businessStatus(business) === 'ACTIVE').length;
        return res.json({
            success: true,
            data: {
                metrics: {
                    companies: businesses.length,
                    activeCompanies,
                    suspendedCompanies: businesses.length - activeCompanies,
                    newCompanies30d: businesses.filter((business) => business.createdAt && business.createdAt.getTime() >= thirtyDaysAgo).length,
                    subscriptions: subscriptions.length,
                    activeSubscriptions: statusCounts.ACTIVE,
                    trialingSubscriptions: statusCounts.TRIALING,
                    pastDueSubscriptions: statusCounts.PAST_DUE,
                    scheduledCancellations: subscriptions.filter((subscription) => subscription.cancelAtPeriodEnd).length,
                    mrrByCurrency: [...mrr.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ currency, amountMinor })),
                },
                statusDistribution: SUBSCRIPTION_STATUSES.map((status) => ({ status, count: statusCounts[status] })),
                planDistribution: [...planCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
                recentSubscriptions: subscriptions.slice(0, 8).map(subscriptionView),
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    listPlans,
    createPlan,
    updatePlan,
    listSubscriptions,
    saveSubscription,
    getDashboard,
    planView,
    subscriptionView,
};

