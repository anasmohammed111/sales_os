const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const FollowUp = require('../src/models/FollowUp');
const AdmissionApplication = require('../src/models/AdmissionApplication');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const api = (user) => ({
    get: (path, query = {}) => request(app).get(`/api/admissions${path}`).query(query).set(h.auth(user)),
    post: (path, body) => request(app).post(`/api/admissions${path}`).set(h.auth(user)).send(body),
    patch: (path, body) => request(app).patch(`/api/admissions${path}`).set(h.auth(user)).send(body),
});

const HOUR = 60 * 60 * 1000;
const inHours = (n) => new Date(Date.now() + n * HOUR).toISOString();

const setup = async () => {
    const team = await h.makeAdmissionsTeam();
    const res = await api(team.owner).post('/applications', h.studentPayload({ counsellorId: team.counsellorA._id.toString() }));
    return { ...team, applicationId: res.body.data.id };
};

const addTask = (user, applicationId, body = {}) =>
    api(user).post(`/applications/${applicationId}/tasks`, {
        type: 'CALL',
        title: 'Call about documents',
        scheduledAt: inHours(2),
        priority: 'HIGH',
        ...body,
    });

test("a follow-up appears in the responsible counsellor's task list only", async () => {
    const { owner, counsellorA, counsellorB, applicationId } = await setup();

    const created = await addTask(owner, applicationId);
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.data.assignedTo.name, 'Counsellor A');

    const mine = await api(counsellorA).get('/tasks');
    assert.strictEqual(mine.body.data.length, 1);
    assert.strictEqual(mine.body.data[0].student.name, 'Asha Nair');
    assert.strictEqual(mine.body.data[0].applicationId, applicationId);
    assert.strictEqual(mine.body.data[0].priority, 'HIGH');

    assert.strictEqual((await api(counsellorB).get('/tasks')).body.data.length, 0);
    assert.strictEqual((await api(owner).get('/tasks')).body.data.length, 0);
    assert.strictEqual((await api(owner).get('/tasks', { assignedTo: 'ALL' })).body.data.length, 1);
    assert.strictEqual((await api(owner).get('/tasks', { assignedTo: counsellorA._id.toString() })).body.data.length, 1);
    // A counsellor cannot widen their list to someone else
    assert.strictEqual((await api(counsellorB).get('/tasks', { assignedTo: counsellorA._id.toString() })).status, 403);
});

test('completing a task records when, and it leaves the pending list', async () => {
    const { counsellorA, applicationId } = await setup();
    const task = (await addTask(counsellorA, applicationId)).body.data;

    const done = await api(counsellorA).patch(`/tasks/${task.id}`, { status: 'COMPLETED', outcome: 'Student will send passport' });
    assert.strictEqual(done.status, 200);
    assert.strictEqual(done.body.data.status, 'COMPLETED');
    assert.ok(done.body.data.completedAt);

    assert.strictEqual((await api(counsellorA).get('/tasks')).body.data.length, 0);
    assert.strictEqual((await api(counsellorA).get('/tasks', { status: 'ALL' })).body.data.length, 1);
});

test('next follow-up is the earliest pending task and follows reschedules', async () => {
    const { counsellorA, applicationId } = await setup();
    const later = (await addTask(counsellorA, applicationId, { scheduledAt: inHours(48) })).body.data;
    const sooner = (await addTask(counsellorA, applicationId, { scheduledAt: inHours(5) })).body.data;

    let app = await AdmissionApplication.findById(applicationId);
    assert.strictEqual(app.nextFollowUpAt.toISOString(), sooner.scheduledAt);

    await api(counsellorA).patch(`/tasks/${sooner.id}`, { scheduledAt: inHours(72) });
    app = await AdmissionApplication.findById(applicationId);
    assert.strictEqual(app.nextFollowUpAt.toISOString(), later.scheduledAt);

    await api(counsellorA).patch(`/tasks/${later.id}`, { status: 'COMPLETED' });
    await api(counsellorA).patch(`/tasks/${sooner.id}`, { status: 'CANCELLED' });
    app = await AdmissionApplication.findById(applicationId);
    assert.strictEqual(app.nextFollowUpAt, null);
});

test('an overdue follow-up shows up in the overdue filter', async () => {
    const { counsellorA, applicationId } = await setup();
    await addTask(counsellorA, applicationId, { scheduledAt: inHours(-3) });

    const overdue = await api(counsellorA).get('/applications', { overdue: '1' });
    assert.strictEqual(overdue.body.data.total, 1);
    assert.ok(overdue.body.data.items[0].warnings.includes('FOLLOW_UP_OVERDUE'));
});

test('other staff can neither add nor change tasks on a record they cannot see', async () => {
    const { counsellorA, counsellorB, applicationId } = await setup();
    const task = (await addTask(counsellorA, applicationId)).body.data;

    assert.strictEqual((await addTask(counsellorB, applicationId)).status, 404);
    assert.strictEqual((await api(counsellorB).patch(`/tasks/${task.id}`, { status: 'COMPLETED' })).status, 404);
});

test('a salesperson cannot hand a task to someone else', async () => {
    const { counsellorA, counsellorB, applicationId } = await setup();

    const res = await addTask(counsellorA, applicationId, { assignedTo: counsellorB._id.toString() });
    assert.strictEqual(res.status, 403);
});

test('task input is validated', async () => {
    const { counsellorA, applicationId } = await setup();

    assert.strictEqual((await addTask(counsellorA, applicationId, { scheduledAt: 'tomorrow' })).status, 400);
    assert.strictEqual((await addTask(counsellorA, applicationId, { type: 'PARTY' })).status, 400);
    assert.strictEqual((await addTask(counsellorA, applicationId, { priority: 'URGENT' })).status, 400);
});

test('editing an admissions follow-up from the old Follow-ups screen still refreshes the next follow-up', async () => {
    const { counsellorA, applicationId } = await setup();
    const task = (await addTask(counsellorA, applicationId, { scheduledAt: inHours(5) })).body.data;

    const moved = new Date(Date.now() + 30 * HOUR);
    await FollowUp.findOneAndUpdate({ _id: task.id }, { $set: { scheduledAt: moved } });

    const app = await AdmissionApplication.findById(applicationId);
    assert.strictEqual(app.nextFollowUpAt.toISOString(), moved.toISOString());
});

test('the legacy follow-ups API accepts the new admissions task types', async () => {
    const { counsellorA, applicationId } = await setup();
    const application = await AdmissionApplication.findById(applicationId);

    const res = await request(app)
        .post('/api/follow-ups')
        .set(h.auth(counsellorA))
        .send({ leadId: application.studentId.toString(), type: 'VISA', scheduledAt: inHours(10) });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
});
