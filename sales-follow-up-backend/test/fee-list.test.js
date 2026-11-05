const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const AdmissionFee = require('../src/models/AdmissionFee');
const { conditionMet, feesForEvent, stageFeeHolds, itemFeeHold } = require('../src/services/admissions/feeRules');
const { buildDefaultConfig } = require('../src/services/admissions/configService');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const api = (user) => ({
    get: (path, query = {}) => request(app).get(`/api/admissions${path}`).query(query).set(h.auth(user)),
    post: (path, body) => request(app).post(`/api/admissions${path}`).set(h.auth(user)).send(body),
    patch: (path, body) => request(app).patch(`/api/admissions${path}`).set(h.auth(user)).send(body),
    put: (path, body) => request(app).put(`/api/admissions${path}`).set(h.auth(user)).send(body),
});

const setup = async () => {
    const team = await h.makeAdmissionsTeam({ fees: true });
    const res = await api(team.owner).post('/applications', h.studentPayload({ counsellorId: team.counsellorA._id.toString() }));
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    return { ...team, id: res.body.data.id };
};

const feesOf = async (user, id) => (await api(user).get(`/applications/${id}/fees`)).body.data;
const feeByKey = async (user, id, key) => (await feesOf(user, id)).fees.find((f) => f.scheduleKey === key);
const pay = (user, feeId, amount) => api(user).post(`/fees/${feeId}/transactions`, { amount, paidAt: new Date().toISOString() });
const tick = (user, id, itemKey) => api(user).patch(`/applications/${id}/checklist/${itemKey}`, { status: 'COMPLETED' });
const jump = (user, id, from, to) =>
    api(user).post(`/applications/${id}/stage`, { fromStageKey: from, toStageKey: to, override: true, reason: 'Test setup jump' });
const profile = async (user, id) => (await api(user).get(`/applications/${id}`)).body.data;

// --- Rules (no database) ---

test('fee conditions are true, false, or unknown until recorded', () => {
    const app0 = { studyLevel: 'MASTER', assessment: { interviewRequired: null, examRequired: null } };
    assert.strictEqual(conditionMet(null, app0), true);
    assert.strictEqual(conditionMet('MASTER', app0), true);
    assert.strictEqual(conditionMet('BACHELOR', app0), false);
    assert.strictEqual(conditionMet('INTERVIEW_OR_EXAM', app0), null);
    assert.strictEqual(conditionMet('INTERVIEW_OR_EXAM', { assessment: { interviewRequired: false, examRequired: true } }), true);
    assert.strictEqual(conditionMet('INTERVIEW_OR_EXAM', { assessment: { interviewRequired: false, examRequired: false } }), false);
});

test('events pick the fees attached to that step only', () => {
    const config = buildDefaultConfig('b1');
    config.stages.forEach((s) => (s.isArchived = false));
    const student = { studyLevel: 'MASTER', assessment: {}, visa: {} };
    const keys = (event) => feesForEvent(config, student, event).map((f) => f.key);

    assert.deepStrictEqual(keys({ type: 'STAGES_ENTERED', stageKeys: ['lead_counselling'] }), ['registration_fee']);
    assert.deepStrictEqual(keys({ type: 'STAGES_ENTERED', stageKeys: ['nostrification'] }), ['translation', 'document_courier', 'nostrification']);
    assert.deepStrictEqual(keys({ type: 'ITEM_COMPLETED', itemKey: 'visa_appointment_registered' }), ['embassy_interview', 'embassy_date']);
    assert.deepStrictEqual(keys({ type: 'VISA_APPROVED' }), ['visa_approval']);
    // Manual fees never come from events; conditional ones wait for their condition
    assert.ok(!keys({ type: 'STAGES_ENTERED', stageKeys: ['offer_letter'] }).includes('alternative_accommodation'));
    assert.ok(!keys({ type: 'STAGES_ENTERED', stageKeys: ['university_application'] }).includes('interview_exam_preparation'));
});

test('holds read the unpaid fees kept on the student', () => {
    const config = buildDefaultConfig('b1');
    const student = {
        paymentSummary: {
            openScheduledFees: [
                { scheduleKey: 'registration_fee', name: 'Registration fee', outstandingMinor: 500000, currency: 'INR', needsAmount: false },
                { scheduleKey: 'university_application_fee', name: 'University application fee', outstandingMinor: 0, currency: 'INR', needsAmount: true },
            ],
        },
    };
    const holds = stageFeeHolds(student, config, 'lead_counselling');
    assert.strictEqual(holds.length, 1);
    assert.strictEqual(holds[0].label, 'Registration fee paid');
    assert.strictEqual(holds[0].reason, '5000.00 INR outstanding');
    assert.match(itemFeeHold(student, config, 'application_submitted'), /University application fee \(amount not set yet\)/);
    assert.strictEqual(itemFeeHold(student, config, 'enquiry_received'), null);
});

// --- Through the API ---

test('a new student gets the first step fee, and the stage waits until it is paid', async () => {
    const { owner, counsellorA, id } = await setup();

    const fee = await feeByKey(counsellorA, id, 'registration_fee');
    assert.ok(fee, 'registration fee added automatically');
    assert.strictEqual(fee.amountDue, '5000.00');
    assert.strictEqual(fee.category, 'SERVICE_FEE');
    assert.strictEqual(fee.refundable, true);
    assert.ok(new Date(fee.dueDate) > new Date(Date.now() + 6 * 24 * 3600 * 1000), 'due in about a week');

    for (const item of ['enquiry_received', 'counselling_completed', 'course_budget_intake_discussed']) {
        assert.strictEqual((await tick(counsellorA, id, item)).status, 200);
    }
    const blocked = await api(counsellorA).post(`/applications/${id}/stage`, { fromStageKey: 'lead_counselling', toStageKey: 'university_selection' });
    assert.strictEqual(blocked.status, 422);
    const missing = blocked.body.data.missing;
    assert.deepStrictEqual(missing.map((m) => m.label), ['Registration fee paid']);
    assert.strictEqual(missing[0].reason, '5000.00 INR outstanding');
    assert.strictEqual((await profile(counsellorA, id)).canAdvance, false);

    assert.strictEqual((await pay(counsellorA, fee.id, '5000')).status, 200);
    assert.strictEqual((await profile(counsellorA, id)).canAdvance, true);
    const moved = await api(counsellorA).post(`/applications/${id}/stage`, { fromStageKey: 'lead_counselling', toStageKey: 'university_selection' });
    assert.strictEqual(moved.status, 200, JSON.stringify(moved.body));

    // Back and forward again never charges twice
    assert.strictEqual((await api(owner).post(`/applications/${id}/stage`, { fromStageKey: 'university_selection', toStageKey: 'lead_counselling' })).status, 200);
    assert.strictEqual((await jump(owner, id, 'lead_counselling', 'apostille')).status, 200);
    const fees = (await feesOf(owner, id)).fees;
    assert.strictEqual(fees.filter((f) => f.scheduleKey === 'registration_fee').length, 1);
    assert.strictEqual(fees.filter((f) => f.scheduleKey === 'apostille').length, 1);
});

test('a checklist item can wait for a payment, and a payment item ticks itself', async () => {
    const { owner, counsellorA, id } = await setup();
    await jump(owner, id, 'lead_counselling', 'apostille');

    const blocked = await tick(counsellorA, id, 'documents_sent_for_apostille');
    assert.strictEqual(blocked.status, 400);
    assert.strictEqual(blocked.body.code, 'PAYMENT_REQUIRED');
    assert.match(blocked.body.message, /Apostille \(4000\.00 INR outstanding\)/);
    const entry = (await profile(counsellorA, id)).checklist.find((e) => e.itemKey === 'documents_sent_for_apostille');
    assert.match(entry.blockedBy, /Waiting for payment: Apostille/);

    await pay(counsellorA, (await feeByKey(counsellorA, id, 'apostille')).id, '4000');
    assert.strictEqual((await tick(counsellorA, id, 'documents_sent_for_apostille')).status, 200);

    // Nostrification: paying the fee ticks "Nostrification payment completed"
    await jump(owner, id, 'apostille', 'nostrification');
    const nostrification = await feeByKey(counsellorA, id, 'nostrification');
    assert.strictEqual(nostrification.amountDue, '15000.00');
    await pay(counsellorA, nostrification.id, '15000');
    const item = (await profile(counsellorA, id)).checklist.find((e) => e.itemKey === 'nostrification_payment_completed');
    assert.strictEqual(item.status, 'COMPLETED');
});

test('a fee without a fixed amount is set per student before it can be paid', async () => {
    const { owner, counsellorA, id } = await setup();
    await jump(owner, id, 'lead_counselling', 'university_application');

    const fee = await feeByKey(counsellorA, id, 'university_application_fee');
    assert.strictEqual(fee.needsAmount, true);
    assert.strictEqual((await pay(counsellorA, fee.id, '100')).status, 400);
    assert.match((await tick(counsellorA, id, 'application_submitted')).body.message, /amount not set yet/);

    const set = await api(counsellorA).patch(`/fees/${fee.id}`, { amountDue: '3500' });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(set.body.data.needsAmount, false);
    assert.strictEqual(set.body.data.outstanding, '3500.00');
});

test('conditional, item-triggered and visa-approval fees arrive at their moment', async () => {
    const { owner, counsellorA, id } = await setup();
    await jump(owner, id, 'lead_counselling', 'university_application');
    assert.strictEqual(await feeByKey(counsellorA, id, 'interview_exam_preparation'), undefined, 'not known yet');

    await api(counsellorA).patch(`/applications/${id}`, { assessment: { interviewRequired: true, examRequired: false } });
    const prep = await feeByKey(counsellorA, id, 'interview_exam_preparation');
    assert.strictEqual(prep.amountDue, '10000.00');

    await jump(owner, id, 'university_application', 'offer_letter');
    assert.strictEqual(await feeByKey(counsellorA, id, 'offer_letter'), undefined);
    await tick(counsellorA, id, 'offer_letter_received');
    assert.strictEqual((await feeByKey(counsellorA, id, 'offer_letter')).amountDue, '25000.00');

    await jump(owner, id, 'offer_letter', 'visa');
    await tick(counsellorA, id, 'visa_appointment_registered');
    const fees = (await feesOf(counsellorA, id)).fees.map((f) => f.scheduleKey);
    assert.ok(fees.includes('embassy_interview') && fees.includes('embassy_date'));

    const approved = await api(counsellorA).post(`/applications/${id}/visa-outcome`, { outcome: 'APPROVED' });
    assert.strictEqual(approved.status, 200, JSON.stringify(approved.body));
    assert.strictEqual((await feeByKey(counsellorA, id, 'visa_approval')).amountDue, '30000.00');
});

test('the payments tab shows what is coming, and optional fees are added by hand once', async () => {
    const { counsellorA, id } = await setup();
    const { plan } = await feesOf(counsellorA, id);
    const state = (key) => plan.find((p) => p.key === key)?.state;

    assert.strictEqual(state('registration_fee'), undefined, 'already on the student');
    assert.strictEqual(state('apostille'), 'UPCOMING');
    assert.strictEqual(state('interview_exam_preparation'), 'UPCOMING');
    assert.strictEqual(state('alternative_accommodation'), 'OPTIONAL');
    assert.strictEqual(plan.find((p) => p.key === 'offer_letter').triggerItemLabel, 'Offer letter received by email');

    const added = await api(counsellorA).post(`/applications/${id}/fees`, { scheduleKey: 'alternative_accommodation' });
    assert.strictEqual(added.status, 201, JSON.stringify(added.body));
    assert.strictEqual(added.body.data.currency, 'CZK');
    assert.strictEqual(added.body.data.amountDue, '5000.00');
    assert.strictEqual((await api(counsellorA).post(`/applications/${id}/fees`, { scheduleKey: 'alternative_accommodation' })).status, 409);
});

test('the fee list is fully customisable and only affects steps still ahead', async () => {
    const { owner, counsellorA, id } = await setup();
    await jump(owner, id, 'lead_counselling', 'apostille');

    const settings = (await api(owner).get('/settings')).body.data;
    const fees = settings.fees.map((f) => (f.key === 'apostille' ? { ...f, amount: '4500', hold: 'NONE' } : f));
    fees.push({
        name: 'Visa file check',
        category: 'SERVICE_FEE',
        amount: '2000',
        currency: 'INR',
        stageKey: 'university_selection',
        trigger: 'ITEM_COMPLETED',
        triggerItemKey: 'final_choice_confirmed',
        hold: 'NONE',
        dueInDays: 3,
    });

    const bad = await api(owner).put('/settings', {
        fees: [...fees.slice(0, -1), { ...fees.at(-1), triggerItemKey: 'visa_documents_ready' }],
    });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.message, /choose which "University Selection" checklist item adds this fee/);

    const saved = await api(owner).put('/settings', { fees });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const added = saved.body.data.fees.find((f) => f.name === 'Visa file check');
    assert.strictEqual(added.key, 'visa_file_check');
    assert.strictEqual(added.amount, '2000.00');

    // Already past University Selection: the new fee is not charged, but offered
    const { plan } = await feesOf(counsellorA, id);
    assert.strictEqual(plan.find((p) => p.key === 'visa_file_check').state, 'NOT_ADDED');
    assert.strictEqual((await feeByKey(counsellorA, id, 'apostille')).amountDue, '4000.00', 'existing fees keep their amount');

    // A new student gets the edited amount and no hold
    const second = await api(owner).post('/applications', h.studentPayload({ student: { email: 'b@example.com', phone: '+91 90000 00001' } }));
    await jump(owner, second.body.data.id, 'lead_counselling', 'apostille');
    assert.strictEqual((await feeByKey(owner, second.body.data.id, 'apostille')).amountDue, '4500.00');
    assert.strictEqual((await tick(owner, second.body.data.id, 'documents_sent_for_apostille')).status, 200);

    // In use: archive, not delete. Archived fees are no longer added.
    const removed = await api(owner).put('/settings', { fees: fees.filter((f) => f.key !== 'registration_fee') });
    assert.strictEqual(removed.status, 400);
    assert.match(removed.body.message, /archive it instead/);
    const archived = await api(owner).put('/settings', { fees: fees.map((f) => (f.key === 'registration_fee' ? { ...f, isArchived: true } : f)) });
    assert.strictEqual(archived.status, 200);
    const third = await api(owner).post('/applications', h.studentPayload({ student: { email: 'c@example.com', phone: '+91 90000 00002' } }));
    assert.strictEqual(await feeByKey(owner, third.body.data.id, 'registration_fee'), undefined);
    assert.strictEqual(await AdmissionFee.countDocuments({ applicationId: third.body.data.id }), 0);
});

test('migration 003 renames old fee types and gives existing businesses the fee list', async () => {
    const mongoose = require('mongoose');
    const AdmissionConfig = require('../src/models/AdmissionConfig');
    const migration = require('../src/migrations/003-fee-list');
    const business = await h.makeBusiness();
    const config = { ...buildDefaultConfig(business._id), fees: [] };
    config.stages = config.stages.map((s) => ({
        ...s,
        items: s.items.map((i) => (i.key === 'nostrification_payment_completed' ? { ...i, paymentCategory: 'NOSTRIFICATION_FEE' } : i)),
    }));
    // Stored the old way: no fee list, old type names (written raw, as old code did)
    await AdmissionConfig.collection.insertOne({ ...config, fees: undefined });
    const applicationId = new mongoose.Types.ObjectId();
    await AdmissionFee.collection.insertOne({
        businessId: business._id,
        applicationId,
        category: 'AGENCY_FEE',
        amountDueMinor: 100,
        currency: 'INR',
        transactions: [],
        isArchived: false,
    });

    await migration.up();
    await migration.up(); // safe to run twice

    const stored = await AdmissionConfig.findOne({ businessId: business._id }).lean();
    assert.strictEqual(stored.fees.length, 13);
    const item = stored.stages.flatMap((s) => s.items).find((i) => i.key === 'nostrification_payment_completed');
    assert.strictEqual(item.paymentCategory, 'STUDENT_EXPENSE');
    assert.strictEqual((await AdmissionFee.findOne({ applicationId }).lean()).category, 'SERVICE_FEE');
});

test('counsellors cannot change the fee list', async () => {
    const { counsellorA } = await setup();
    const res = await api(counsellorA).put('/settings', { fees: [] });
    assert.strictEqual(res.status, 403);
});
