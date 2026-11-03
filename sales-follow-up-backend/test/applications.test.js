const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const Lead = require('../src/models/Leads');
const AdmissionApplication = require('../src/models/AdmissionApplication');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const create = (user, body) =>
    request(app).post('/api/admissions/applications').set(h.auth(user)).send(h.studentPayload(body));
const list = (user, query = {}) =>
    request(app).get('/api/admissions/applications').query(query).set(h.auth(user));
const get = (user, id) => request(app).get(`/api/admissions/applications/${id}`).set(h.auth(user));

test('admin creates a student and assigns a counsellor', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();

    const res = await create(owner, { counsellorId: counsellorA._id.toString() });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const created = res.body.data;
    assert.strictEqual(created.currentStage.key, 'lead_counselling');
    assert.strictEqual(created.counsellor.name, 'Counsellor A');
    assert.strictEqual(created.student.name, 'Asha Nair');
    assert.strictEqual(created.status, 'ACTIVE');
    assert.strictEqual(created.daysInStage, 0);

    const lead = await Lead.findById(created.studentId);
    assert.strictEqual(lead.source, 'INSTAGRAM');
    assert.strictEqual(lead.assignedTo.toString(), counsellorA._id.toString());
    assert.strictEqual(lead.city, 'Kochi');
    assert.strictEqual(lead.phoneDigits, '9876543210');
});

test('only the assigned counsellor and their manager can see the student', async () => {
    const { owner, manager, counsellorA, counsellorB } = await h.makeAdmissionsTeam();
    const id = (await create(owner, { counsellorId: counsellorA._id.toString() })).body.data.id;

    assert.strictEqual((await get(counsellorA, id)).status, 200);
    assert.strictEqual((await get(manager, id)).status, 200);
    assert.strictEqual((await get(owner, id)).status, 200);
    assert.strictEqual((await get(counsellorB, id)).status, 404);

    assert.strictEqual((await list(counsellorA)).body.data.total, 1);
    assert.strictEqual((await list(counsellorB)).body.data.total, 0);
});

test('a salesperson creates students for themselves and cannot assign others', async () => {
    const { counsellorA, counsellorB } = await h.makeAdmissionsTeam();

    const own = await create(counsellorA, {});
    assert.strictEqual(own.status, 201);
    assert.strictEqual(own.body.data.counsellor.name, 'Counsellor A');

    const other = await create(counsellorA, {
        student: { email: 'other@example.com', phone: '+91 91111 22222' },
        counsellorId: counsellorB._id.toString(),
    });
    assert.strictEqual(other.status, 403);
});

test('possible duplicates by normalised phone are flagged, never merged', async () => {
    const { owner } = await h.makeAdmissionsTeam();
    await create(owner, {});

    const dup = await create(owner, { student: { name: 'Asha N', email: 'different@example.com', phone: '098765-43210' } });
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.code, 'POSSIBLE_DUPLICATE');
    assert.deepStrictEqual(dup.body.data.matches[0].matchedOn, ['phone']);

    const confirmed = await create(owner, {
        student: { name: 'Asha N', email: 'different@example.com', phone: '098765-43210' },
        confirmDuplicate: true,
    });
    assert.strictEqual(confirmed.status, 201);
    assert.strictEqual(await Lead.countDocuments({}), 2);
});

test('duplicate check matches email and hides details of records outside scope', async () => {
    const { owner, counsellorA, counsellorB } = await h.makeAdmissionsTeam();
    await create(owner, { counsellorId: counsellorA._id.toString() });

    const asOwner = await request(app)
        .post('/api/admissions/applications/check-duplicates')
        .set(h.auth(owner))
        .send({ email: 'ASHA@example.com' });
    assert.strictEqual(asOwner.status, 200);
    assert.strictEqual(asOwner.body.data.matches[0].name, 'Asha Nair');
    assert.deepStrictEqual(asOwner.body.data.matches[0].matchedOn, ['email']);

    const asB = await request(app)
        .post('/api/admissions/applications/check-duplicates')
        .set(h.auth(counsellorB))
        .send({ phone: '9876543210' });
    assert.strictEqual(asB.body.data.matches.length, 1);
    assert.strictEqual(asB.body.data.matches[0].inScope, false);
    assert.strictEqual(asB.body.data.matches[0].name, undefined);
});

test('a returning student gets a new application and the old one is kept', async () => {
    const { owner } = await h.makeAdmissionsTeam();
    const first = (await create(owner, {})).body.data;

    const second = await request(app)
        .post('/api/admissions/applications')
        .set(h.auth(owner))
        .send({ studentId: first.studentId, studyLevel: 'MASTER', intakeMonth: 2, intakeYear: 2028, leadSource: 'referral' });

    assert.strictEqual(second.status, 201, JSON.stringify(second.body));
    assert.strictEqual(second.body.data.studentId, first.studentId);
    assert.strictEqual(await AdmissionApplication.countDocuments({ studentId: first.studentId }), 2);

    const profile = await get(owner, first.id);
    assert.strictEqual(profile.body.data.intakeMonth, 9);
    assert.strictEqual(profile.body.data.otherApplications.length, 1);
});

test('editing the student from the Leads screen updates the admissions search snapshot', async () => {
    const { owner } = await h.makeAdmissionsTeam();
    const created = (await create(owner, {})).body.data;

    await Lead.findOneAndUpdate(
        { _id: created.studentId },
        { $set: { customerName: 'Asha Menon', phone: '+91 90000 11111' } },
        { new: true }
    );

    const found = await list(owner, { search: '90000 11111' });
    assert.strictEqual(found.body.data.total, 1);
    assert.strictEqual(found.body.data.items[0].student.name, 'Asha Menon');
});

test('search matches name, phone and email', async () => {
    const { owner } = await h.makeAdmissionsTeam();
    await create(owner, {});

    for (const search of ['asha', 'NAIR', '98765', 'asha@exa']) {
        assert.strictEqual((await list(owner, { search })).body.data.total, 1, `search "${search}"`);
    }
    assert.strictEqual((await list(owner, { search: 'zzz' })).body.data.total, 0);
    assert.strictEqual((await list(owner, { search: '.*' })).body.data.total, 0);
});

test('filters by level, intake and counsellor', async () => {
    const { owner, counsellorA, counsellorB } = await h.makeAdmissionsTeam();
    await create(owner, { counsellorId: counsellorA._id.toString() });
    await create(owner, {
        student: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '+91 92222 33333' },
        studyLevel: 'BACHELOR',
        intakeMonth: 2,
        intakeYear: 2028,
        counsellorId: counsellorB._id.toString(),
    });

    assert.strictEqual((await list(owner, { studyLevel: 'BACHELOR' })).body.data.total, 1);
    assert.strictEqual((await list(owner, { intakeYear: 2027, intakeMonth: 9 })).body.data.total, 1);
    assert.strictEqual((await list(owner, { counsellorId: counsellorB._id.toString() })).body.data.total, 1);
    // A counsellor filtering for someone else's records still only gets their own scope
    assert.strictEqual((await list(counsellorA, { counsellorId: counsellorB._id.toString() })).body.data.total, 0);
});

test('invalid input is rejected with a clear message', async () => {
    const { owner } = await h.makeAdmissionsTeam();

    const noName = await create(owner, { student: { name: ' ' } });
    assert.strictEqual(noName.status, 400);
    assert.match(noName.body.message, /name/i);

    const badSource = await create(owner, { leadSource: 'tiktok' });
    assert.strictEqual(badSource.status, 400);

    const badMonth = await create(owner, { intakeMonth: 13 });
    assert.strictEqual(badMonth.status, 400);

    const noContact = await create(owner, { student: { email: '', phone: '' } });
    assert.strictEqual(noContact.status, 400);
});

test('recording a failed exam flags the application for review', async () => {
    const { owner } = await h.makeAdmissionsTeam();
    const id = (await create(owner, {})).body.data.id;

    const res = await request(app)
        .patch(`/api/admissions/applications/${id}`)
        .set(h.auth(owner))
        .send({ assessment: { interviewRequired: false, examRequired: true, examAt: '2027-03-01T09:00:00.000Z', examResult: 'FAILED' } });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.needsReview, true);
    assert.ok(res.body.data.warnings.includes('NEEDS_REVIEW'));

    const passed = await request(app)
        .patch(`/api/admissions/applications/${id}`)
        .set(h.auth(owner))
        .send({ assessment: { examResult: 'PASSED' } });
    assert.strictEqual(passed.body.data.needsReview, false);
});

test('owner reassigns; the previous counsellor loses access', async () => {
    const { owner, counsellorA, counsellorB } = await h.makeAdmissionsTeam();
    const id = (await create(owner, { counsellorId: counsellorA._id.toString() })).body.data.id;

    const res = await request(app)
        .patch(`/api/admissions/applications/${id}/assign`)
        .set(h.auth(owner))
        .send({ counsellorId: counsellorB._id.toString() });

    assert.strictEqual(res.status, 200);
    assert.strictEqual((await get(counsellorA, id)).status, 404);
    assert.strictEqual((await get(counsellorB, id)).status, 200);

    const blocked = await request(app)
        .patch(`/api/admissions/applications/${id}/assign`)
        .set(h.auth(counsellorB))
        .send({ counsellorId: counsellorA._id.toString() });
    assert.strictEqual(blocked.status, 403);
});
