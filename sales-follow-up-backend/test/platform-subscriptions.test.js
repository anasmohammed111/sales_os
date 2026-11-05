const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const h = require('./helpers');
const app = require('../src/app');
const PlatformAdmin = require('../src/models/PlatformAdmin');
const PlatformAuditLog = require('../src/models/PlatformAuditLog');
const Subscription = require('../src/models/Subscription');
const { resetLoginLimiter } = require('../src/controllers/platformController');

before(h.startDb);
after(h.stopDb);
beforeEach(async () => {
    await h.resetDb();
    resetLoginLimiter();
});

const PASSWORD = 'Correct-Horse-Battery-9';
const tokenFor = async (email, role) => {
    await PlatformAdmin.create({ name: email.split('@')[0], email, role, password: await bcrypt.hash(PASSWORD, 4) });
    const response = await request(app).post('/api/platform/auth/login').send({ email, password: PASSWORD });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    return response.body.data.token;
};
const as = (token) => ({
    get: (path, query = {}) => request(app).get(`/api${path}`).query(query).set('Authorization', `Bearer ${token}`),
    post: (path, body = {}) => request(app).post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (path, body = {}) => request(app).put(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
});

const planPayload = (overrides = {}) => ({
    key: 'GROWTH',
    name: 'Growth',
    description: 'For growing teams',
    currency: 'USD',
    prices: { monthly: 9900, yearly: 99900 },
    trialDays: 14,
    limits: { users: 20, leads: 10000, students: 2000, storageMb: 10240 },
    modules: ['crm', 'admissions'],
    ...overrides,
});

test('billing roles manage plans and subscriptions while support roles cannot', async () => {
    const business = await h.makeBusiness({ name: 'Northstar Education' });
    const billing = as(await tokenFor('billing@kelto.test', 'BILLING_ADMIN'));
    const support = as(await tokenFor('support@kelto.test', 'SUPPORT_ADMIN'));

    const created = await billing.post('/platform/plans', planPayload());
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const planId = created.body.data.plan.id;
    assert.strictEqual((await support.get('/platform/plans')).status, 403);
    assert.strictEqual((await support.get('/platform/dashboard')).status, 403);
    assert.strictEqual(
        (await support.put(`/platform/workspaces/${business._id}/subscription`, { planId, reason: 'Support request' })).status,
        403
    );

    const assigned = await billing.put(`/platform/workspaces/${business._id}/subscription`, {
        planId,
        billingCycle: 'YEARLY',
        status: 'TRIALING',
        reason: 'Annual agreement signed',
        notes: 'Procurement reference PO-42',
    });
    assert.strictEqual(assigned.status, 201, JSON.stringify(assigned.body));
    assert.strictEqual(assigned.body.data.subscription.plan.key, 'GROWTH');
    assert.strictEqual(assigned.body.data.subscription.amountMinor, 99900);
    assert.ok(assigned.body.data.subscription.trialEndsAt);

    const company = await billing.get(`/platform/workspaces/${business._id}`);
    assert.strictEqual(company.body.data.subscription.planName, 'Growth');
    assert.strictEqual(company.body.data.subscription.status, 'TRIALING');
});

test("a plan's modules switch on for the company, and a plan without Admissions switches it off", async () => {
    const business = await h.makeBusiness({ name: 'FlowOne', admissions: false });
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const root = as(await tokenFor('root@kelto.test', 'SUPER_ADMIN'));
    const growth = (await root.post('/platform/plans', planPayload())).body.data.plan.id;
    const starter = (await root.post('/platform/plans', planPayload({ key: 'STARTER', name: 'Starter', modules: ['crm'] }))).body.data.plan.id;
    const subscription = (body) => root.put(`/platform/workspaces/${business._id}/subscription`, body);
    // What the CRM asks before it shows the Admissions menu
    const crmAdmissions = async () => (await request(app).get('/api/admissions/context').set(h.auth(owner))).status;

    assert.strictEqual(await crmAdmissions(), 404);

    const assigned = await subscription({ planId: growth, status: 'ACTIVE', reason: 'Signed up for Growth' });
    assert.strictEqual(assigned.status, 201, JSON.stringify(assigned.body));
    assert.deepStrictEqual(assigned.body.data.modulesChanged, { admissions: { from: false, to: true } });
    assert.strictEqual(await crmAdmissions(), 200);
    const logged = await PlatformAuditLog.findOne({ action: 'FEATURE_CHANGED', businessId: business._id }).lean();
    assert.deepStrictEqual(
        [logged.details.feature, logged.details.to, logged.details.source, logged.details.planKey, logged.reason],
        ['admissions', true, 'subscription', 'GROWTH', 'Signed up for Growth']
    );

    const downgraded = await subscription({ planId: starter, reason: 'Moved to Starter' });
    assert.strictEqual(downgraded.status, 200, JSON.stringify(downgraded.body));
    assert.deepStrictEqual(downgraded.body.data.modulesChanged, { admissions: { from: true, to: false } });
    assert.strictEqual(await crmAdmissions(), 404);

    // Switched on by hand while on Starter: an edit that keeps the plan leaves it alone
    assert.strictEqual((await root.patch(`/platform/workspaces/${business._id}/features`, { admissions: true })).status, 200);
    const noted = await subscription({ notes: 'Pilot of Admissions agreed', reason: 'Added a note' });
    assert.strictEqual(noted.status, 200, JSON.stringify(noted.body));
    assert.deepStrictEqual(noted.body.data.modulesChanged, {});
    assert.strictEqual(await crmAdmissions(), 200);
});

test('subscriptions preserve assigned prices, enforce lifecycle and feed the SaaS dashboard', async () => {
    const business = await h.makeBusiness({ name: 'Acme Study Abroad' });
    const root = as(await tokenFor('root@kelto.test', 'SUPER_ADMIN'));
    const created = await root.post('/platform/plans', planPayload());
    const planId = created.body.data.plan.id;

    const trial = await root.put(`/platform/workspaces/${business._id}/subscription`, {
        planId,
        billingCycle: 'YEARLY',
        status: 'TRIALING',
        reason: 'Customer started trial',
    });
    assert.strictEqual(trial.status, 201, JSON.stringify(trial.body));

    const repriced = await root.patch(`/platform/plans/${planId}`, {
        prices: { monthly: 19900, yearly: 199900 },
    });
    assert.strictEqual(repriced.status, 200, JSON.stringify(repriced.body));

    const activated = await root.put(`/platform/workspaces/${business._id}/subscription`, {
        status: 'ACTIVE',
        reason: 'Trial converted successfully',
    });
    assert.strictEqual(activated.status, 200, JSON.stringify(activated.body));
    assert.strictEqual(activated.body.data.subscription.amountMinor, 99900, 'catalog edits must not rewrite contracted price');

    const invalid = await root.put(`/platform/workspaces/${business._id}/subscription`, {
        status: 'TRIALING',
        reason: 'Invalid backwards move',
    });
    assert.strictEqual(invalid.status, 409);

    const periodEnd = activated.body.data.subscription.currentPeriodEnd;
    const pastDue = await root.put(`/platform/workspaces/${business._id}/subscription`, {
        status: 'PAST_DUE',
        reason: 'Renewal payment pending',
    });
    assert.strictEqual(pastDue.status, 200, JSON.stringify(pastDue.body));
    const settled = await root.put(`/platform/workspaces/${business._id}/subscription`, {
        status: 'ACTIVE',
        reason: 'Renewal payment received',
    });
    assert.strictEqual(settled.status, 200, JSON.stringify(settled.body));
    assert.strictEqual(settled.body.data.subscription.currentPeriodEnd, periodEnd, 'resolving past due keeps the contracted period');

    const list = await root.get('/platform/subscriptions', { search: 'Acme', status: 'ACTIVE', plan: 'GROWTH' });
    assert.strictEqual(list.status, 200, JSON.stringify(list.body));
    assert.strictEqual(list.body.data.total, 1);
    assert.strictEqual(list.body.data.items[0].workspace.businessName, 'Acme Study Abroad');

    const dashboard = await root.get('/platform/dashboard');
    assert.strictEqual(dashboard.status, 200, JSON.stringify(dashboard.body));
    assert.strictEqual(dashboard.body.data.metrics.companies, 1);
    assert.strictEqual(dashboard.body.data.metrics.activeSubscriptions, 1);
    assert.deepStrictEqual(dashboard.body.data.metrics.mrrByCurrency, [{ currency: 'USD', amountMinor: 8325 }]);
    assert.deepStrictEqual(dashboard.body.data.planDistribution, [{ key: 'GROWTH', name: 'Growth', count: 1 }]);

    const stored = await Subscription.findOne({ businessId: business._id });
    assert.strictEqual(stored.planSnapshot.prices.yearly, 99900);
    assert.strictEqual(stored.history.length, 4);
    assert.strictEqual(await PlatformAuditLog.countDocuments({ action: 'SUBSCRIPTION_CREATED' }), 1);
    assert.strictEqual(await PlatformAuditLog.countDocuments({ action: 'SUBSCRIPTION_UPDATED' }), 3);
});

test('plan validation, archiving and subscription change notes are enforced', async () => {
    const business = await h.makeBusiness({ name: 'Validation Co' });
    const root = as(await tokenFor('root@kelto.test', 'SUPER_ADMIN'));
    assert.strictEqual((await root.post('/platform/plans', planPayload({ key: '!', currency: 'US' }))).status, 400);

    const created = await root.post('/platform/plans', planPayload({ key: 'STARTER', name: 'Starter' }));
    const planId = created.body.data.plan.id;
    assert.strictEqual((await root.patch(`/platform/plans/${planId}`, { key: 'RENAMED' })).status, 400);
    assert.strictEqual((await root.patch(`/platform/plans/${planId}`, { status: 'ARCHIVED' })).status, 200);

    const noReason = await root.put(`/platform/workspaces/${business._id}/subscription`, { planId, reason: 'no' });
    assert.strictEqual(noReason.status, 400);
    const archived = await root.put(`/platform/workspaces/${business._id}/subscription`, { planId, reason: 'New subscription' });
    assert.strictEqual(archived.status, 409);
});

test('monthly billing periods clamp safely at the end of shorter months', async () => {
    const business = await h.makeBusiness({ name: 'Month End Co' });
    const root = as(await tokenFor('root@kelto.test', 'SUPER_ADMIN'));
    const created = await root.post('/platform/plans', planPayload({ key: 'MONTH_END', trialDays: 0 }));
    const assigned = await root.put(`/platform/workspaces/${business._id}/subscription`, {
        planId: created.body.data.plan.id,
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        currentPeriodStart: '2027-01-31T00:00:00.000Z',
        reason: 'Month end contract',
    });
    assert.strictEqual(assigned.status, 201, JSON.stringify(assigned.body));
    assert.strictEqual(assigned.body.data.subscription.currentPeriodEnd, '2027-02-28T00:00:00.000Z');
});

