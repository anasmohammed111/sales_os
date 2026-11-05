const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const Lead = require('../src/models/Leads');
const FollowUp = require('../src/models/FollowUp');
const Quotation = require('../src/models/Quotation');

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

const ago = (days) => new Date(Date.now() - days * DAY);
// Backdates a lead's last edit without Mongoose stamping a fresh updatedAt
const lastEdited = (lead, days) => Lead.collection.updateOne({ _id: lead._id }, { $set: { updatedAt: ago(days) } });

test('needs attention: neglected and unassigned leads, and the oldest overdue follow-up', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const a = await h.makeUser(business, { role: 'SALESPERSON', name: 'Seller A' });
    const b = await h.makeUser(business, { role: 'SALESPERSON', name: 'Seller B' });

    const lead = (customerName, status, estimatedValue, assignee = a) =>
        Lead.create({ businessId: business._id, customerName, status, estimatedValue, assignedTo: assignee?._id ?? null, createdBy: owner._id });
    const followUp = (leadDoc, at, extra = {}) =>
        FollowUp.create({ businessId: business._id, leadId: leadDoc._id, assignedTo: a._id, createdBy: owner._id, type: 'CALL', scheduledAt: at, ...extra });

    const idleBig = await lead('Idle Big', 'QUALIFIED', 9000);
    await lastEdited(idleBig, 10);
    const idleSmall = await lead('Idle Small', 'NEW', 500);
    await followUp(idleSmall, ago(8), { status: 'COMPLETED', completedAt: ago(8) });
    await lastEdited(idleSmall, 9);
    const calledRecently = await lead('Called Recently', 'CONTACTED', 4000);
    await followUp(calledRecently, ago(2), { status: 'COMPLETED', completedAt: ago(2) });
    await lastEdited(calledRecently, 10);
    const nextStep = await lead('Next Step', 'NEW', 3000);
    await followUp(nextStep, new Date(Date.now() + 3 * DAY));
    await lastEdited(nextStep, 10);
    const fresh = await lead('Fresh', 'NEW', 100);
    await followUp(fresh, ago(3));
    await followUp(fresh, new Date(Date.now() - HOUR));
    const oldWin = await lead('Old Win', 'WON', 8000);
    await lastEdited(oldWin, 30);
    await lead('Nobody Yet', 'NEW', 200, null);

    const d = (await summary(owner)).body.data;
    assert.strictEqual(d.attention.neglectedLeads.count, 2);
    assert.strictEqual(d.attention.neglectedLeads.idleDays, 7);
    assert.deepStrictEqual(
        d.attention.neglectedLeads.items.map((l) => [l.name, l.value, l.idleDays, l.assignedTo]),
        [
            ['Idle Big', 9000, 10, 'Seller A'],
            ['Idle Small', 500, 8, 'Seller A'],
        ]
    );
    assert.strictEqual(d.attention.neglectedLeads.items[0].statusLabel, 'Qualified');
    assert.strictEqual(d.attention.unassignedLeads, 1);
    assert.strictEqual(d.attention.overdueFollowUps.count, 2);
    assert.strictEqual(Math.round((Date.now() - new Date(d.attention.overdueFollowUps.oldestAt)) / DAY), 3);

    // Another salesperson sees none of Seller A's leads
    const other = (await summary(b)).body.data.attention;
    assert.deepStrictEqual([other.neglectedLeads.count, other.unassignedLeads, other.overdueFollowUps.count], [0, 0, 0]);
    assert.strictEqual(other.overdueFollowUps.oldestAt, null);
});

test('quotations waiting on the customer, expiring soon and accepted this month', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const a = await h.makeUser(business, { role: 'SALESPERSON', name: 'Seller A' });
    const b = await h.makeUser(business, { role: 'SALESPERSON', name: 'Seller B' });
    const leadDoc = await Lead.create({ businessId: business._id, customerName: 'Quote Co', status: 'QUOTATION_SENT', assignedTo: a._id, createdBy: owner._id });

    let n = 0;
    const quote = (assignee, status, grandTotal, { currency = 'INR', validInDays = 30, ...extra } = {}) =>
        Quotation.create({
            businessId: business._id,
            leadId: leadDoc._id,
            quotationNumber: `Q-${++n}`,
            customer: { name: `Customer ${n}` },
            quotationDate: ago(40),
            validUntil: new Date(Date.now() + validInDays * DAY),
            items: [{ itemName: 'Service', quantity: 1, unitPrice: grandTotal, amount: grandTotal }],
            subtotal: grandTotal,
            grandTotal,
            currency,
            status,
            assignedTo: assignee._id,
            createdBy: owner._id,
            ...extra,
        });

    await quote(a, 'SENT', 1200, { validInDays: 3 });
    await quote(a, 'SENT', 800, { validInDays: 20 });
    await quote(b, 'SENT', 100, { currency: 'USD', validInDays: 2 });
    await quote(a, 'SENT', 999, { validInDays: -1 }); // past its date; the expiry job has not run yet
    await quote(a, 'ACCEPTED', 5000, { acceptedAt: new Date(Date.now() - HOUR) });
    await quote(a, 'ACCEPTED', 7000, { acceptedAt: ago(400) });
    await quote(a, 'DRAFT', 300);

    const q = (await summary(owner)).body.data.quotations;
    assert.deepStrictEqual(q.awaiting, { count: 3, totals: [{ currency: 'INR', amount: 2000 }, { currency: 'USD', amount: 100 }] });
    assert.strictEqual(q.expiringSoon.count, 2);
    assert.strictEqual(q.expiringSoon.withinDays, 7);
    assert.deepStrictEqual(
        q.expiringSoon.items.map((i) => [i.number, i.customer, i.amount, i.currency, i.daysLeft]),
        [
            ['Q-3', 'Customer 3', 100, 'USD', 2],
            ['Q-1', 'Customer 1', 1200, 'INR', 3],
        ]
    );
    assert.deepStrictEqual(q.acceptedThisMonth, { count: 1, totals: [{ currency: 'INR', amount: 5000 }] });

    // A salesperson only counts their own quotations
    const mine = (await summary(a)).body.data.quotations;
    assert.deepStrictEqual(mine.awaiting, { count: 2, totals: [{ currency: 'INR', amount: 2000 }] });
    assert.strictEqual(mine.expiringSoon.count, 1);
});

test('people who may not view quotations get no quotation figures', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const rep = await h.makeUser(business, { role: 'SALESPERSON' });
    const role = (
        await request(app).post('/api/roles').set(h.auth(owner)).send({ name: 'Leads only', permissions: ['dashboard.view', 'leads.view', 'followups.view'] })
    ).body.data;
    await request(app).patch(`/api/team/${rep._id}`).set(h.auth(owner)).send({ roleId: role._id });

    const d = (await summary(rep)).body.data;
    assert.strictEqual(d.quotations, null);
    assert.strictEqual(d.attention.neglectedLeads.count, 0);
});
