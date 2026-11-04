const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const Lead = require('../src/models/Leads');
const FollowUp = require('../src/models/FollowUp');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// A fixed-offset zone where it is about midday now, so "today" can't roll over mid-test
const middayZone = () => {
    const offset = new Date().getUTCHours() - 12; // local = UTC - offset
    return offset >= 0 ? `Etc/GMT+${offset}` : `Etc/GMT${offset}`;
};

const summary = (user, tz = middayZone()) =>
    request(app).get('/api/dashboard/summary').query({ tz }).set(h.auth(user));

const setup = async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const a = await h.makeUser(business, { role: 'SALESPERSON', name: 'Seller A' });
    const b = await h.makeUser(business, { role: 'SALESPERSON', name: 'Seller B' });

    const lead = (assignee, customerName, status, estimatedValue, closedDaysAgo) =>
        Lead.create({
            businessId: business._id,
            customerName,
            companyName: `${customerName} Ltd`,
            status,
            estimatedValue,
            assignedTo: assignee._id,
            createdBy: owner._id,
            statusHistory: closedDaysAgo === undefined
                ? []
                : [{ fromStatus: 'NEGOTIATION', toStatus: status, changedBy: owner._id, changedAt: new Date(Date.now() - closedDaysAgo * DAY) }],
        });

    const newLead = await lead(a, 'Nadia', 'NEW', 1000);
    const qualified = await lead(a, 'Omar', 'QUALIFIED', 5000);
    await lead(a, 'Priya', 'WON', 3000, 2);
    await lead(a, 'Quinn', 'LOST', 800, 10);
    await lead(a, 'Old Win', 'WON', 9999, 200);
    const bLead = await lead(b, 'Ravi', 'NEGOTIATION', 7000);

    const followUp = (assignee, leadDoc, at, extra = {}) =>
        FollowUp.create({
            businessId: business._id,
            leadId: leadDoc._id,
            assignedTo: assignee._id,
            createdBy: owner._id,
            type: 'CALL',
            scheduledAt: at,
            ...extra,
        });

    await followUp(a, newLead, new Date(Date.now() - 20 * HOUR), { priority: 'HIGH', notes: 'Chase reply' });
    await followUp(a, qualified, new Date(Date.now() + 2 * HOUR), { type: 'EMAIL' });
    await followUp(a, qualified, new Date(Date.now() - 3 * HOUR), {
        status: 'COMPLETED',
        completedAt: new Date(Date.now() - HOUR),
        outcome: 'Sent brochure',
    });
    await followUp(a, newLead, new Date(Date.now() + 30 * HOUR));
    await followUp(b, bLead, new Date(Date.now() + HOUR));

    return { owner, a, b };
};

test('summary requires sign-in', async () => {
    assert.strictEqual((await request(app).get('/api/dashboard/summary')).status, 401);
});

test("a salesperson's summary counts only their own follow-ups and leads", async () => {
    const { a } = await setup();

    const res = await summary(a);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;

    assert.deepStrictEqual(d.followUpsToday, { total: 3, pending: 2, completed: 1, overdue: 1, urgent: 1 });
    assert.deepStrictEqual(d.queue.map((q) => q.leadName), ['Nadia', 'Omar', 'Omar']);
    assert.deepStrictEqual(d.queue.map((q) => q.status), ['PENDING', 'PENDING', 'COMPLETED']);
    assert.strictEqual(d.queue[0].isOverdue, true);
    assert.strictEqual(d.queue[0].company, 'Nadia Ltd');
    assert.strictEqual(d.queue[0].dealValue, 1000);

    assert.strictEqual(d.pipeline.openCount, 2);
    assert.strictEqual(d.pipeline.openValue, 6000);
    assert.strictEqual(d.pipeline.averageValue, 3000);
    assert.strictEqual(d.pipeline.qualifiedCount, 1);
    assert.deepStrictEqual(
        d.pipeline.byStatus.filter((s) => s.count).map((s) => [s.status, s.count, s.value]),
        [
            ['NEW', 1, 1000],
            ['QUALIFIED', 1, 5000],
        ]
    );

    assert.deepStrictEqual(d.wonLast7Days, { count: 1, value: 3000 });
    assert.strictEqual(d.conversion.won, 1);
    assert.strictEqual(d.conversion.lost, 1);
    assert.strictEqual(d.conversion.rate, 0.5);
    assert.match(d.conversion.definition, /last 90 days/);

    assert.strictEqual(d.recentCompletions.length, 1);
    assert.strictEqual(d.recentCompletions[0].outcome, 'Sent brochure');
    assert.strictEqual(d.currency, 'USD');
});

test('the owner sees the whole business', async () => {
    const { owner } = await setup();

    const d = (await summary(owner)).body.data;

    assert.strictEqual(d.pipeline.openCount, 3);
    assert.strictEqual(d.pipeline.openValue, 13000);
    assert.strictEqual(d.followUpsToday.pending, 3);
});

test('an unknown timezone is rejected', async () => {
    const { owner } = await setup();
    assert.strictEqual((await summary(owner, 'Mars/Base')).status, 400);
});
