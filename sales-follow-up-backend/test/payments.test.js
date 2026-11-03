const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const AdmissionApplication = require('../src/models/AdmissionApplication');
const AdmissionFee = require('../src/models/AdmissionFee');
const Reminder = require('../src/models/Reminder');
const { computeFee, summarize } = require('../src/services/admissions/payments');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const DAY = 24 * 60 * 60 * 1000;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('receipt body')]);

const api = (user) => ({
    get: (path, query = {}) => request(app).get(`/api/admissions${path}`).query(query).set(h.auth(user)),
    post: (path, body) => request(app).post(`/api/admissions${path}`).set(h.auth(user)).send(body),
    patch: (path, body) => request(app).patch(`/api/admissions${path}`).set(h.auth(user)).send(body),
});

const setup = async () => {
    const team = await h.makeAdmissionsTeam();
    const res = await api(team.owner).post('/applications', h.studentPayload({ counsellorId: team.counsellorA._id.toString() }));
    return { ...team, applicationId: res.body.data.id };
};

const addFee = (user, applicationId, body = {}) =>
    api(user).post(`/applications/${applicationId}/fees`, {
        category: 'AGENCY_FEE',
        amountDue: '1000',
        currency: 'INR',
        dueDate: new Date(Date.now() + 10 * DAY).toISOString(),
        ...body,
    });

const pay = (user, feeId, amount, extra = {}) =>
    api(user).post(`/fees/${feeId}/transactions`, {
        amount,
        paidAt: new Date().toISOString(),
        reference: 'UPI-123',
        ...extra,
    });

test('computeFee derives paid, outstanding and status from non-voided transactions', () => {
    const fee = { amountDueMinor: 100000, transactions: [] };
    assert.deepStrictEqual(computeFee(fee), { paidMinor: 0, outstandingMinor: 100000, status: 'UNPAID' });

    fee.transactions.push({ amountMinor: 40000, isVoided: false }, { amountMinor: 99999, isVoided: true });
    assert.deepStrictEqual(computeFee(fee), { paidMinor: 40000, outstandingMinor: 60000, status: 'PARTIALLY_PAID' });

    fee.transactions.push({ amountMinor: 60000, isVoided: false });
    assert.deepStrictEqual(computeFee(fee), { paidMinor: 100000, outstandingMinor: 0, status: 'PAID' });
});

test('summarize never adds different currencies together', () => {
    const rows = summarize([
        { currency: 'INR', amountDueMinor: 100000, paidMinor: 40000, outstandingMinor: 60000 },
        { currency: 'EUR', amountDueMinor: 50000, paidMinor: 0, outstandingMinor: 50000 },
        { currency: 'INR', amountDueMinor: 20000, paidMinor: 20000, outstandingMinor: 0 },
    ]);
    assert.deepStrictEqual(rows, [
        { currency: 'EUR', dueMinor: 50000, paidMinor: 0, outstandingMinor: 50000 },
        { currency: 'INR', dueMinor: 120000, paidMinor: 60000, outstandingMinor: 60000 },
    ]);
});

test('partial then full payment calculates the balance and status', async () => {
    const { counsellorA, applicationId } = await setup();
    const fee = (await addFee(counsellorA, applicationId)).body.data;
    assert.strictEqual(fee.status, 'UNPAID');

    const partial = await pay(counsellorA, fee.id, '400');
    assert.strictEqual(partial.status, 200, JSON.stringify(partial.body));
    assert.strictEqual(partial.body.data.status, 'PARTIALLY_PAID');
    assert.strictEqual(partial.body.data.outstanding, '600.00');

    const full = await pay(counsellorA, fee.id, '600');
    assert.strictEqual(full.body.data.status, 'PAID');
    assert.strictEqual(full.body.data.outstandingMinor, 0);
    assert.strictEqual(full.body.data.transactions.length, 2);

    const application = await AdmissionApplication.findById(applicationId);
    assert.strictEqual(application.paymentSummary.status, 'PAID');
    assert.deepStrictEqual(application.paymentSummary.byCurrency.map((r) => [r.currency, r.paidMinor]), [['INR', 100000]]);
});

test('a payment larger than the outstanding balance is refused', async () => {
    const { counsellorA, applicationId } = await setup();
    const fee = (await addFee(counsellorA, applicationId)).body.data;
    await pay(counsellorA, fee.id, '900');

    const over = await pay(counsellorA, fee.id, '200');
    assert.strictEqual(over.status, 400);
    assert.match(over.body.message, /more than the outstanding balance \(100\.00 INR\)/);
});

test('voiding a payment needs a reason and restores the balance', async () => {
    const { counsellorA, applicationId } = await setup();
    const fee = (await addFee(counsellorA, applicationId)).body.data;
    const paid = (await pay(counsellorA, fee.id, '1000')).body.data;
    const txId = paid.transactions[0].id;

    assert.strictEqual((await api(counsellorA).patch(`/fees/${fee.id}/transactions/${txId}/void`, {})).status, 400);

    const voided = await api(counsellorA).patch(`/fees/${fee.id}/transactions/${txId}/void`, { reason: 'Bounced cheque' });
    assert.strictEqual(voided.status, 200);
    assert.strictEqual(voided.body.data.status, 'UNPAID');
    assert.strictEqual(voided.body.data.transactions[0].isVoided, true);
});

test('fees in different currencies are summarised separately', async () => {
    const { counsellorA, applicationId } = await setup();
    await addFee(counsellorA, applicationId, { amountDue: '50000', currency: 'INR' });
    await addFee(counsellorA, applicationId, { category: 'UNIVERSITY_FEE', amountDue: '3000', currency: 'EUR' });

    const res = await api(counsellorA).get(`/applications/${applicationId}/fees`);
    assert.deepStrictEqual(
        res.body.data.summary.map((r) => [r.currency, r.outstanding]),
        [
            ['EUR', '3000.00'],
            ['INR', '50000.00'],
        ]
    );
});

test('completing the "University fee paid" checklist item does not mark the fee paid', async () => {
    const { owner, counsellorA, applicationId } = await setup();
    const fee = (await addFee(counsellorA, applicationId, { category: 'UNIVERSITY_FEE', currency: 'EUR' })).body.data;
    await api(owner).post(`/applications/${applicationId}/stage`, {
        fromStageKey: 'lead_counselling',
        toStageKey: 'offer_letter',
        override: true,
        reason: 'Test setup jump',
    });

    const item = await api(counsellorA).patch(`/applications/${applicationId}/checklist/university_fee_paid`, { status: 'COMPLETED' });
    assert.strictEqual(item.status, 200);

    assert.strictEqual((await AdmissionFee.findById(fee.id)).status, 'UNPAID');
});

test('ambiguous or invalid amounts are rejected; plain decimals are stored exactly', async () => {
    const { counsellorA, applicationId } = await setup();

    for (const amountDue of ['1,500', '10.555', 0, '0', '-5', 'abc', '']) {
        const res = await addFee(counsellorA, applicationId, { amountDue });
        assert.strictEqual(res.status, 400, `amount ${JSON.stringify(amountDue)}`);
    }

    const ok = await addFee(counsellorA, applicationId, { amountDue: '1500.5' });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.body.data.amountDueMinor, 150050);

    assert.strictEqual((await addFee(counsellorA, applicationId, { currency: 'GBP' })).status, 400);
    assert.strictEqual((await addFee(counsellorA, applicationId, { category: 'TIP' })).status, 400);
});

test('payment tracker is scoped, filterable and totals by currency', async () => {
    const { owner, counsellorA, counsellorB, applicationId } = await setup();
    const inr = (await addFee(counsellorA, applicationId, { amountDue: '1000', currency: 'INR' })).body.data;
    await addFee(counsellorA, applicationId, {
        category: 'NOSTRIFICATION_FEE',
        amountDue: '200',
        currency: 'EUR',
        dueDate: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    await pay(counsellorA, inr.id, '250');

    const all = await api(owner).get('/payments');
    assert.strictEqual(all.status, 200);
    assert.strictEqual(all.body.data.items.length, 2);
    assert.deepStrictEqual(
        all.body.data.totals.map((t) => [t.currency, t.outstanding]),
        [
            ['EUR', '200.00'],
            ['INR', '750.00'],
        ]
    );
    assert.strictEqual(all.body.data.items[0].student.name, 'Asha Nair');

    assert.strictEqual((await api(counsellorB).get('/payments')).body.data.items.length, 0);
    assert.strictEqual((await api(owner).get('/payments', { status: 'OVERDUE' })).body.data.items.length, 1);
    assert.strictEqual((await api(owner).get('/payments', { status: 'PARTIALLY_PAID' })).body.data.items.length, 1);
    assert.strictEqual((await api(owner).get('/payments', { category: 'NOSTRIFICATION_FEE' })).body.data.items.length, 1);

    const application = await AdmissionApplication.findById(applicationId);
    assert.ok(application.paymentSummary.nextDueAt < new Date(), 'overdue fee drives nextDueAt');
});

test('a receipt can be attached and only opened by staff with access', async () => {
    const { counsellorA, counsellorB, applicationId } = await setup();
    const fee = (await addFee(counsellorA, applicationId)).body.data;

    const res = await request(app)
        .post(`/api/admissions/fees/${fee.id}/transactions`)
        .set(h.auth(counsellorA))
        .field('amount', '100')
        .field('paidAt', new Date().toISOString())
        .field('reference', 'NEFT-9')
        .attach('file', PDF, 'receipt.pdf');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const tx = res.body.data.transactions[0];
    assert.strictEqual(tx.hasReceipt, true);

    const link = await api(counsellorA).get(`/fees/${fee.id}/transactions/${tx.id}/receipt-url`);
    assert.strictEqual(link.status, 200);
    assert.strictEqual((await request(app).get(link.body.data.url)).status, 200);

    assert.strictEqual((await api(counsellorB).get(`/fees/${fee.id}/transactions/${tx.id}/receipt-url`)).status, 404);
    assert.strictEqual((await pay(counsellorB, fee.id, '1')).status, 404);
});

test('a fee with a due date schedules a payment reminder until it is paid', async () => {
    const { counsellorA, applicationId } = await setup();
    const fee = (await addFee(counsellorA, applicationId)).body.data;

    assert.strictEqual(await Reminder.countDocuments({ kind: 'PAYMENT_DUE', status: 'SCHEDULED' }), 1);
    await pay(counsellorA, fee.id, '1000');
    assert.strictEqual(await Reminder.countDocuments({ kind: 'PAYMENT_DUE', status: 'SCHEDULED' }), 0);
});
