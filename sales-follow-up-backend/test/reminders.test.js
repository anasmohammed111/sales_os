const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const Reminder = require('../src/models/Reminder');
const Notification = require('../src/models/Notification');
const AdmissionApplication = require('../src/models/AdmissionApplication');
const AdmissionConfig = require('../src/models/AdmissionConfig');
const {
    syncRemindersForApplication,
    processDueReminders,
    runStuckCheck,
} = require('../src/services/admissions/reminders');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const DAY = 24 * 60 * 60 * 1000;
const fromNow = (ms) => new Date(Date.now() + ms);

const api = (user) => ({
    get: (path, query = {}) => request(app).get(path).query(query).set(h.auth(user)),
    post: (path, body) => request(app).post(path).set(h.auth(user)).send(body),
    patch: (path, body) => request(app).patch(path).set(h.auth(user)).send(body),
});

const setup = async () => {
    const team = await h.makeAdmissionsTeam();
    const res = await api(team.owner).post(
        '/api/admissions/applications',
        h.studentPayload({ counsellorId: team.counsellorA._id.toString() })
    );
    return { ...team, applicationId: res.body.data.id };
};

const addTask = (user, applicationId, scheduledAt) =>
    api(user).post(`/api/admissions/applications/${applicationId}/tasks`, {
        type: 'CALL',
        title: 'Call student',
        scheduledAt: scheduledAt.toISOString(),
    });

test('syncing twice schedules a follow-up reminder only once', async () => {
    const { counsellorA, applicationId } = await setup();
    const due = fromNow(2 * DAY);
    await addTask(counsellorA, applicationId, due);

    await syncRemindersForApplication(applicationId);
    await syncRemindersForApplication(applicationId);

    const rows = await Reminder.find({ kind: 'FOLLOW_UP' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'SCHEDULED');
    assert.strictEqual(rows[0].userId.toString(), counsellorA._id.toString());
    assert.strictEqual(rows[0].remindAt.getTime(), due.getTime() - 30 * 60 * 1000);
});

test('processing due reminders twice creates one notification', async () => {
    const { counsellorA, applicationId } = await setup();
    await addTask(counsellorA, applicationId, fromNow(2 * DAY));

    const later = fromNow(3 * DAY);
    assert.strictEqual(await processDueReminders(later), 1);
    assert.strictEqual(await processDueReminders(later), 0);

    const notes = await Notification.find({ userId: counsellorA._id });
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0].title, /Follow-up due: Asha Nair/);
    assert.strictEqual(notes[0].link, `/admissions/students/${applicationId}`);
    assert.strictEqual((await Reminder.findOne({ kind: 'FOLLOW_UP' })).status, 'SENT');
});

test('exam reminders fire the configured number of days before the exam', async () => {
    const { counsellorA, applicationId } = await setup();
    const examAt = fromNow(10 * DAY);

    await api(counsellorA).patch(`/api/admissions/applications/${applicationId}`, {
        assessment: { interviewRequired: false, examRequired: true, examAt: examAt.toISOString() },
    });

    const reminder = await Reminder.findOne({ kind: 'EXAM' });
    assert.ok(reminder, 'exam reminder scheduled');
    assert.strictEqual(reminder.remindAt.getTime(), examAt.getTime() - 2 * DAY);

    // Once the result is in, there is nothing left to remind about
    await api(counsellorA).patch(`/api/admissions/applications/${applicationId}`, { assessment: { examResult: 'PASSED' } });
    assert.strictEqual((await Reminder.findOne({ kind: 'EXAM' })).status, 'CANCELLED');
});

test('events already in the past are not scheduled', async () => {
    const { counsellorA, applicationId } = await setup();
    await addTask(counsellorA, applicationId, fromNow(-DAY));

    assert.strictEqual(await Reminder.countDocuments({}), 0);
});

test('rescheduling a task replaces its reminder', async () => {
    const { counsellorA, applicationId } = await setup();
    const task = (await addTask(counsellorA, applicationId, fromNow(2 * DAY))).body.data;

    await api(counsellorA).patch(`/api/admissions/tasks/${task.id}`, { scheduledAt: fromNow(5 * DAY).toISOString() });

    assert.strictEqual(await Reminder.countDocuments({ status: 'SCHEDULED' }), 1);
    assert.strictEqual(await Reminder.countDocuments({ status: 'CANCELLED' }), 1);
});

test('stuck alerts follow each stage threshold and fire once per stage entry', async () => {
    const { business, counsellorA, applicationId } = await setup();
    await AdmissionApplication.updateOne({ _id: applicationId }, { $set: { stageEnteredAt: fromNow(-8 * DAY) } });

    assert.strictEqual(await runStuckCheck(new Date()), 1);
    assert.strictEqual(await runStuckCheck(new Date()), 0);
    const alert = await Notification.findOne({ type: 'STUCK' });
    assert.strictEqual(alert.userId.toString(), counsellorA._id.toString());
    assert.match(alert.title, /Lead \/ Counselling/);

    // Raising the threshold to 10 days means 8 days is no longer stuck
    await Notification.deleteMany({});
    await AdmissionConfig.updateOne(
        { businessId: business._id, 'stages.key': 'lead_counselling' },
        { $set: { 'stages.$.stuckThresholdDays': 10 } }
    );
    assert.strictEqual(await runStuckCheck(new Date()), 0);
});

test('applications with a final visa outcome are excluded from stuck alerts and reminders', async () => {
    const { counsellorA, applicationId } = await setup();
    await addTask(counsellorA, applicationId, fromNow(2 * DAY));
    await AdmissionApplication.updateOne(
        { _id: applicationId },
        { $set: { status: 'CLOSED', 'visa.outcome': 'REJECTED', stageEnteredAt: fromNow(-30 * DAY) } }
    );

    await syncRemindersForApplication(applicationId);

    assert.strictEqual(await runStuckCheck(new Date()), 0);
    assert.strictEqual(await Reminder.countDocuments({ status: 'SCHEDULED' }), 0);
});

test('reassigning moves tasks and reminders to the new counsellor', async () => {
    const { owner, counsellorA, counsellorB, applicationId } = await setup();
    await addTask(counsellorA, applicationId, fromNow(2 * DAY));
    await api(counsellorA).patch(`/api/admissions/applications/${applicationId}`, {
        visa: { appointmentAt: fromNow(20 * DAY).toISOString() },
    });

    const res = await api(owner).patch(`/api/admissions/applications/${applicationId}/assign`, {
        counsellorId: counsellorB._id.toString(),
    });
    assert.strictEqual(res.status, 200);

    const scheduled = await Reminder.find({ status: 'SCHEDULED' });
    assert.strictEqual(scheduled.length, 2);
    assert.ok(scheduled.every((r) => r.userId.toString() === counsellorB._id.toString()));

    assert.strictEqual((await api(counsellorA).get(`/api/admissions/applications/${applicationId}`)).status, 404);
    assert.strictEqual((await api(counsellorB).get('/api/admissions/tasks')).body.data.length, 1);
    assert.strictEqual((await api(counsellorA).get('/api/admissions/tasks')).body.data.length, 0);
});

test('notifications API lists only my notifications and marks them read', async () => {
    const { counsellorA, counsellorB, applicationId } = await setup();
    await addTask(counsellorA, applicationId, fromNow(DAY));
    await processDueReminders(fromNow(2 * DAY));

    const mine = await api(counsellorA).get('/api/notifications');
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(mine.body.data.items.length, 1);
    assert.strictEqual(mine.body.data.unreadCount, 1);
    assert.strictEqual((await api(counsellorB).get('/api/notifications')).body.data.items.length, 0);

    const id = mine.body.data.items[0].id;
    assert.strictEqual((await api(counsellorB).patch(`/api/notifications/${id}/read`)).status, 404);
    assert.strictEqual((await api(counsellorA).patch(`/api/notifications/${id}/read`)).status, 200);
    assert.strictEqual((await api(counsellorA).get('/api/notifications/unread-count')).body.data.count, 0);
});

test('rescheduling from the general Follow-ups screen also updates the reminder', async () => {
    const { counsellorA, applicationId } = await setup();
    const task = (await addTask(counsellorA, applicationId, fromNow(2 * DAY))).body.data;
    const FollowUp = require('../src/models/FollowUp');

    const moved = fromNow(6 * DAY);
    await FollowUp.findOneAndUpdate({ _id: task.id }, { $set: { scheduledAt: moved } });

    const scheduled = await Reminder.find({ status: 'SCHEDULED' });
    assert.strictEqual(scheduled.length, 1);
    assert.strictEqual(scheduled[0].eventAt.getTime(), moved.getTime());
});
