const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const AdmissionActivity = require('../src/models/AdmissionActivity');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const api = (user) => ({
    get: (path) => request(app).get(`/api/admissions${path}`).set(h.auth(user)),
    post: (path, body) => request(app).post(`/api/admissions${path}`).set(h.auth(user)).send(body),
    patch: (path, body) => request(app).patch(`/api/admissions${path}`).set(h.auth(user)).send(body),
});

const createStudent = async (owner, counsellor) => {
    const res = await api(owner).post('/applications', h.studentPayload({ counsellorId: counsellor._id.toString() }));
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
};

const detail = async (user, id) => (await api(user).get(`/applications/${id}`)).body.data;

/** Completes every applicable required item still pending in the current stage. */
const completeCurrentStage = async (user, id) => {
    const profile = await detail(user, id);
    const pending = profile.checklist.filter(
        (e) => e.stageKey === profile.currentStage.key && e.required && e.isApplicable && e.status === 'PENDING'
    );
    for (const entry of pending) {
        const res = await api(user).patch(`/applications/${id}/checklist/${entry.itemKey}`, { status: 'COMPLETED' });
        assert.strictEqual(res.status, 200, `${entry.itemKey}: ${JSON.stringify(res.body)}`);
    }
    return profile;
};

const move = (user, id, fromStageKey, toStageKey, extra = {}) =>
    api(user).post(`/applications/${id}/stage`, { fromStageKey, toStageKey, ...extra });

const adminJump = async (owner, id, from, to) => {
    const res = await move(owner, id, from, to, { override: true, reason: 'Test setup jump' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
};

test('incomplete requirements block the move and say exactly what is missing', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);

    const res = await move(counsellorA, id, 'lead_counselling', 'university_selection');

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, 'STAGE_REQUIREMENTS_MISSING');
    assert.match(res.body.message, /University Selection/);
    assert.deepStrictEqual(
        res.body.data.missing.map((m) => m.label),
        ['Enquiry received', 'Counselling completed', 'Course, budget and intake discussed']
    );
});

test('skipping a stage also requires the skipped stage', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);
    await completeCurrentStage(counsellorA, id);

    const res = await move(counsellorA, id, 'lead_counselling', 'apostille');

    assert.strictEqual(res.status, 422);
    assert.ok(res.body.data.missing.every((m) => m.stageKey === 'university_selection'));
    assert.strictEqual(res.body.data.missing.length, 2);
});

test('not applicable needs a reason and rules block completion without data', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);

    const noReason = await api(counsellorA).patch(`/applications/${id}/checklist/enquiry_received`, {
        status: 'NOT_APPLICABLE',
    });
    assert.strictEqual(noReason.status, 400);
    assert.match(noReason.body.message, /reason/i);

    const noChoice = await api(counsellorA).patch(`/applications/${id}/checklist/final_choice_confirmed`, {
        status: 'COMPLETED',
    });
    assert.strictEqual(noChoice.status, 400);
    assert.strictEqual(noChoice.body.message, "Record the student's final university and course first");

    const withReason = await api(counsellorA).patch(`/applications/${id}/checklist/enquiry_received`, {
        status: 'NOT_APPLICABLE',
        reason: 'Walk-in, no enquiry form',
    });
    assert.strictEqual(withReason.status, 200);
    const entry = withReason.body.data.checklist.find((e) => e.itemKey === 'enquiry_received');
    assert.strictEqual(entry.status, 'NOT_APPLICABLE');
    assert.strictEqual(entry.naReason, 'Walk-in, no enquiry form');
});

test('only an admin can override, and must give a reason that is recorded', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);

    const staff = await move(counsellorA, id, 'lead_counselling', 'university_selection', { override: true, reason: 'Please' });
    assert.strictEqual(staff.status, 403);
    assert.strictEqual(staff.body.code, 'OVERRIDE_NOT_ALLOWED');

    const noReason = await move(owner, id, 'lead_counselling', 'university_selection', { override: true, reason: 'ok' });
    assert.strictEqual(noReason.status, 400);
    assert.strictEqual(noReason.body.code, 'OVERRIDE_REASON_REQUIRED');

    const ok = await move(owner, id, 'lead_counselling', 'university_selection', {
        override: true,
        reason: 'Counselling done by phone, form pending',
    });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));

    const profile = await detail(owner, id);
    const visit = profile.stageHistory.at(-1);
    assert.strictEqual(visit.stageKey, 'university_selection');
    assert.strictEqual(visit.override, true);
    assert.strictEqual(visit.reason, 'Counselling done by phone, form pending');
    assert.strictEqual(visit.overriddenItems.length, 3);

    const activity = await AdmissionActivity.findOne({ applicationId: id, type: 'STAGE_MOVED' });
    assert.strictEqual(activity.meta.override, true);
});

test('backward moves are logged with timestamps and keep checklist history', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);
    await completeCurrentStage(counsellorA, id);
    assert.strictEqual((await move(counsellorA, id, 'lead_counselling', 'university_selection')).status, 200);

    const back = await move(counsellorA, id, 'university_selection', 'lead_counselling', { reason: 'Student changed course' });
    assert.strictEqual(back.status, 200);

    const profile = await detail(owner, id);
    assert.deepStrictEqual(
        profile.stageHistory.map((v) => [v.stageKey, v.direction]),
        [
            ['lead_counselling', 'INITIAL'],
            ['university_selection', 'FORWARD'],
            ['lead_counselling', 'BACKWARD'],
        ]
    );
    assert.ok(profile.stageHistory[0].exitedAt && profile.stageHistory[1].exitedAt);
    assert.strictEqual(profile.stageHistory[2].exitedAt, null);
    assert.ok(profile.checklist.filter((e) => e.stageKey === 'lead_counselling').every((e) => e.status === 'COMPLETED'));
});

test('a stale move (double click or second tab) is rejected and changes nothing', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);
    await completeCurrentStage(counsellorA, id);

    assert.strictEqual((await move(counsellorA, id, 'lead_counselling', 'university_selection')).status, 200);
    const again = await move(counsellorA, id, 'lead_counselling', 'university_selection');

    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.code, 'STAGE_CONFLICT');
    assert.strictEqual((await detail(owner, id)).stageHistory.length, 2);
});

test('a failed entrance exam blocks progress and flags the application for review', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);
    await adminJump(owner, id, 'lead_counselling', 'university_application');

    await api(counsellorA).patch(`/applications/${id}`, {
        assessment: { interviewRequired: false, examRequired: true, examAt: '2027-03-01T09:00:00Z', examResult: 'FAILED' },
    });
    await completeCurrentStage(counsellorA, id);

    const res = await move(counsellorA, id, 'university_application', 'pre_enrollment');

    assert.strictEqual(res.status, 422);
    assert.deepStrictEqual(res.body.data.missing, []);
    assert.strictEqual(res.body.data.gateError, 'The entrance exam was failed. The application is flagged for review.');
    const profile = await detail(owner, id);
    assert.strictEqual(profile.currentStage.key, 'university_application');
    assert.strictEqual(profile.needsReview, true);
});

test('a visa rejection closes the application without approval or further moves', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);

    const early = await api(counsellorA).post(`/applications/${id}/visa-outcome`, { outcome: 'REJECTED' });
    assert.strictEqual(early.status, 409);

    await adminJump(owner, id, 'lead_counselling', 'visa');
    const res = await api(counsellorA).post(`/applications/${id}/visa-outcome`, { outcome: 'REJECTED' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const profile = await detail(owner, id);
    assert.strictEqual(profile.status, 'CLOSED');
    assert.strictEqual(profile.visa.outcome, 'REJECTED');
    assert.strictEqual(profile.checklist.find((e) => e.itemKey === 'visa_result_recorded').status, 'COMPLETED');

    const moveAfter = await move(owner, id, 'visa', 'offer_letter', { override: true, reason: 'Trying to reopen' });
    assert.strictEqual(moveAfter.status, 409);
    assert.strictEqual(moveAfter.body.code, 'APPLICATION_CLOSED');

    const staffChange = await api(counsellorA).post(`/applications/${id}/visa-outcome`, { outcome: 'APPROVED' });
    assert.strictEqual(staffChange.status, 403);
});

test('a student progresses through all eight stages to an approved visa', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);
    const user = counsellorA;

    await api(user).patch(`/applications/${id}`, {
        finalChoice: { universityName: 'Charles University', courseName: 'MSc Data Science' },
        assessment: {
            interviewRequired: true,
            examRequired: true,
            interviewAt: '2027-02-10T09:00:00Z',
            examAt: '2027-02-12T09:00:00Z',
            interviewResult: 'PASSED',
            examResult: 'PASSED',
        },
        visa: { appointmentAt: '2027-06-01T09:00:00Z' },
    });

    const order = [
        'lead_counselling',
        'university_selection',
        'apostille',
        'university_application',
        'pre_enrollment',
        'nostrification',
        'offer_letter',
        'visa',
    ];

    for (let i = 0; i < order.length - 1; i += 1) {
        await completeCurrentStage(user, id);
        const res = await move(user, id, order[i], order[i + 1]);
        assert.strictEqual(res.status, 200, `${order[i]} → ${order[i + 1]}: ${JSON.stringify(res.body)}`);
    }

    await completeCurrentStage(user, id).catch(() => {});
    const outcome = await api(user).post(`/applications/${id}/visa-outcome`, { outcome: 'APPROVED' });
    assert.strictEqual(outcome.status, 200, JSON.stringify(outcome.body));

    const profile = await detail(owner, id);
    assert.strictEqual(profile.status, 'CLOSED');
    assert.strictEqual(profile.visa.outcome, 'APPROVED');
    assert.deepStrictEqual(profile.stageHistory.map((v) => v.stageKey), order);
    assert.ok(profile.stageHistory.every((v) => !v.override));
    assert.ok(profile.stageHistory.every((v) => v.exitedAt));
});

test('notes are added to the activity timeline with their author', async () => {
    const { owner, counsellorA, counsellorB } = await h.makeAdmissionsTeam();
    const { id } = await createStudent(owner, counsellorA);

    const empty = await api(counsellorA).post(`/applications/${id}/notes`, { body: '  ' });
    assert.strictEqual(empty.status, 400);

    const note = await api(counsellorA).post(`/applications/${id}/notes`, { body: 'Parents want a call on Friday' });
    assert.strictEqual(note.status, 201);

    const activity = await api(counsellorA).get(`/applications/${id}/activity`);
    const first = activity.body.data[0];
    assert.strictEqual(first.type, 'NOTE');
    assert.strictEqual(first.body, 'Parents want a call on Friday');
    assert.strictEqual(first.actor.name, 'Counsellor A');

    assert.strictEqual((await api(counsellorB).get(`/applications/${id}/activity`)).status, 404);
    assert.strictEqual((await api(counsellorB).post(`/applications/${id}/notes`, { body: 'x' })).status, 404);
});
