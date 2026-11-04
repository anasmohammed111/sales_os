const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const api = (user) => ({
    get: (path, query = {}) => request(app).get(`/api/admissions${path}`).query(query).set(h.auth(user)),
    post: (path, body) => request(app).post(`/api/admissions${path}`).set(h.auth(user)).send(body),
    patch: (path, body) => request(app).patch(`/api/admissions${path}`).set(h.auth(user)).send(body),
});

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

const setup = async () => {
    const team = await h.makeAdmissionsTeam();
    const res = await api(team.owner).post('/applications', h.studentPayload({ counsellorId: team.counsellorA._id.toString() }));
    return { ...team, applicationId: res.body.data.id };
};

const schedule = (user, applicationId, assessment) => api(user).patch(`/applications/${applicationId}`, { assessment });

test('upcoming interviews and exams are listed earliest first, scoped to who can see the student', async () => {
    const { owner, counsellorA, counsellorB, applicationId } = await setup();

    const res = await schedule(counsellorA, applicationId, {
        interviewRequired: true,
        interviewAt: inDays(2),
        examRequired: true,
        examAt: inDays(1),
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const mine = await api(counsellorA).get('/assessments');
    assert.strictEqual(mine.status, 200);
    assert.deepStrictEqual(mine.body.data.upcoming.map((e) => e.type), ['EXAM', 'INTERVIEW']);
    assert.strictEqual(mine.body.data.upcoming[0].student.name, 'Asha Nair');
    assert.strictEqual(mine.body.data.upcoming[0].applicationId, applicationId);
    assert.strictEqual(mine.body.data.awaitingResult.length, 0);

    assert.strictEqual((await api(counsellorB).get('/assessments')).body.data.upcoming.length, 0);
    assert.strictEqual((await api(owner).get('/assessments')).body.data.upcoming.length, 2);
});

test('past interviews still PENDING wait for a result; older ones drop off after 30 days', async () => {
    const { counsellorA, applicationId } = await setup();

    await schedule(counsellorA, applicationId, {
        interviewRequired: true,
        interviewAt: inDays(-3),
        examRequired: true,
        examAt: inDays(-40),
    });

    let data = (await api(counsellorA).get('/assessments')).body.data;
    assert.strictEqual(data.upcoming.length, 0);
    assert.deepStrictEqual(data.awaitingResult.map((e) => e.type), ['INTERVIEW']);

    await schedule(counsellorA, applicationId, { interviewResult: 'PASSED' });
    data = (await api(counsellorA).get('/assessments')).body.data;
    assert.strictEqual(data.awaitingResult.length, 0);
});

test('an assessment marked as not required does not appear', async () => {
    const { counsellorA, applicationId } = await setup();

    await schedule(counsellorA, applicationId, { interviewRequired: false, interviewAt: inDays(2) });

    const data = (await api(counsellorA).get('/assessments')).body.data;
    assert.strictEqual(data.upcoming.length, 0);
});
