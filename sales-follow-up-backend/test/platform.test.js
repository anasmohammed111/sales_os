const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const h = require('./helpers');
const app = require('../src/app');
const Lead = require('../src/models/Leads');
const PlatformAdmin = require('../src/models/PlatformAdmin');
const PlatformAuditLog = require('../src/models/PlatformAuditLog');
const { resetLoginLimiter } = require('../src/controllers/platformController');

before(h.startDb);
after(h.stopDb);
beforeEach(async () => {
    await h.resetDb();
    resetLoginLimiter();
});

const ADMIN_PASSWORD = 'Correct-Horse-Battery-9';

const makeAdmin = async (extra = {}) =>
    PlatformAdmin.create({
        name: 'Platform Owner',
        email: 'root@kelto.test',
        password: await bcrypt.hash(ADMIN_PASSWORD, 4),
        ...extra,
    });

const signIn = (email = 'root@kelto.test', password = ADMIN_PASSWORD) =>
    request(app).post('/api/platform/auth/login').send({ email, password });

const consoleApi = (token) => ({
    get: (path, query = {}) => request(app).get(`/api/platform${path}`).query(query).set('Authorization', `Bearer ${token}`),
    post: (path, body = {}) => request(app).post(`/api/platform${path}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api/platform${path}`).set('Authorization', `Bearer ${token}`).send(body),
});

const asToken = (token) => ({
    get: (path) => request(app).get(`/api${path}`).set('Authorization', `Bearer ${token}`),
    post: (path, body = {}) => request(app).post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (path, body = {}) => request(app).put(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
    delete: (path) => request(app).delete(`/api${path}`).set('Authorization', `Bearer ${token}`),
});

/** Two workspaces with people, leads and an admissions student. */
const twoWorkspaces = async () => {
    const team = await h.makeAdmissionsTeam();
    const other = await h.makeBusiness({ name: 'Other Agency', admissions: false });
    const otherOwner = await h.makeUser(other, { role: 'OWNER', name: 'Other Owner' });
    for (const [business, owner, assignee, name] of [
        [team.business, team.owner, team.counsellorA, 'Lead A'],
        [team.business, team.owner, team.counsellorB, 'Lead B'],
        [other, otherOwner, otherOwner, 'Other lead'],
    ]) {
        await Lead.create({ businessId: business._id, customerName: name, createdBy: owner._id, assignedTo: assignee._id });
    }
    const student = await request(app)
        .post('/api/admissions/applications')
        .set(h.auth(team.owner))
        .send(h.studentPayload({ counsellorId: team.counsellorA._id.toString() }));
    assert.strictEqual(student.status, 201, JSON.stringify(student.body));
    return { ...team, other, otherOwner, studentId: student.body.data.id };
};

const consoleToken = async () => {
    await makeAdmin();
    const res = await signIn();
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    return res.body.data.token;
};

const viewToken = async (token, businessId) => {
    const res = await consoleApi(token).post(`/workspaces/${businessId}/view`, { reason: 'Customer support check', path: '/dashboard' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    return res.body.data.token;
};

test('no HTTP route can create or promote a super admin', async () => {
    const { owner } = await twoWorkspaces();
    const tries = [
        request(app).post('/api/platform/admins').send({ email: 'x@y.z', password: 'whatever-123456' }),
        request(app).post('/api/platform/auth/register').send({ email: 'x@y.z', password: 'whatever-123456' }),
        request(app).post('/api/platform/admins').set(h.auth(owner)).send({ email: 'x@y.z' }),
        request(app).get('/api/platform/workspaces').set(h.auth(owner)),
    ];
    for (const res of await Promise.all(tries)) assert.ok([401, 404].includes(res.status), `got ${res.status}`);
    assert.strictEqual(await PlatformAdmin.countDocuments(), 0);
});

test('sign-in works, wrong passwords are rejected, and five in a row lock the account', async () => {
    await makeAdmin();
    assert.strictEqual((await signIn()).status, 200);
    assert.strictEqual((await signIn('root@kelto.test', 'nope')).status, 401);
    assert.strictEqual((await signIn('nobody@kelto.test', 'nope')).status, 401);

    for (let i = 0; i < 4; i += 1) await signIn('root@kelto.test', 'still wrong');
    const locked = await signIn();
    assert.strictEqual(locked.status, 423, 'locked even with the right password');
    assert.match(locked.body.message, /Try again in 15 minutes/);

    const actions = (await PlatformAuditLog.find().sort({ createdAt: 1 })).map((e) => e.action);
    assert.strictEqual(actions[0], 'LOGIN');
    assert.strictEqual(actions.filter((a) => a === 'LOGIN_FAILED').length, 7);
});

test('the console lists every workspace with its counts, and users without secrets', async () => {
    const { business, other } = await twoWorkspaces();
    const api = consoleApi(await consoleToken());

    const list = await api.get('/workspaces');
    assert.strictEqual(list.status, 200);
    const mine = list.body.data.items.find((w) => w.id === String(business._id));
    assert.deepStrictEqual(mine.counts, { users: 4, activeUsers: 4, leads: 3, students: 1, activeStudents: 1 });
    assert.strictEqual(mine.features.admissions, true);
    assert.ok(mine.lastActivityAt);
    assert.strictEqual(list.body.data.items.find((w) => w.id === String(other._id)).counts.leads, 1);
    assert.deepStrictEqual(list.body.data.totals, { workspaces: 2, users: 5, leads: 4, students: 1 });

    const search = await api.get('/workspaces', { search: 'other' });
    assert.deepStrictEqual(search.body.data.items.map((w) => w.businessName), ['Other Agency']);

    const detail = await api.get(`/workspaces/${business._id}`);
    assert.strictEqual(detail.body.data.users.length, 4);

    const users = await api.get('/users', { search: 'owner' });
    assert.strictEqual(users.body.data.total, 2);
    const raw = JSON.stringify(users.body);
    assert.ok(!/password|resetPassword/i.test(raw), 'no secrets in the user list');
    assert.ok(users.body.data.items.every((u) => u.workspace?.businessName));
});

test('console and workspace tokens only work where they belong', async () => {
    const { owner } = await twoWorkspaces();
    const token = await consoleToken();
    assert.strictEqual((await asToken(token).get('/leads')).status, 401, 'console token cannot read workspace APIs');
    assert.strictEqual((await request(app).get('/api/platform/workspaces').set(h.auth(owner))).status, 401);
});

test('a view token reads everything in one workspace and can change nothing', async () => {
    const { business, studentId } = await twoWorkspaces();
    const token = await consoleToken();

    const short = await consoleApi(token).post(`/workspaces/${business._id}/view`, { reason: 'hi' });
    assert.strictEqual(short.status, 400, 'a reason is required');

    const view = asToken(await viewToken(token, business._id));
    const leads = await view.get('/leads');
    assert.strictEqual(leads.status, 200, JSON.stringify(leads.body));
    assert.deepStrictEqual(leads.body.data.leads.map((l) => l.customerName).sort(), ['Asha Nair', 'Lead A', 'Lead B']);
    assert.strictEqual((await view.get('/admissions/applications')).body.data.items.length, 1);
    assert.strictEqual((await view.get(`/admissions/applications/${studentId}/fees`)).status, 200);
    assert.strictEqual((await view.get('/admissions/settings')).status, 200);
    assert.strictEqual((await view.get('/roles')).status, 200);

    const me = await view.get('/auth/me');
    assert.strictEqual(me.status, 200);
    assert.match(me.body.data.user.name, /\(super admin\)/);
    assert.strictEqual(me.body.data.access.readOnly, true);
    assert.ok(me.body.data.access.permissions.includes('leads.view'));
    assert.ok(!me.body.data.access.permissions.includes('leads.create'), 'the app hides edit buttons');
    assert.match((await view.get('/settings')).body.data.profile.name, /\(super admin\)/);

    const before = await Lead.countDocuments();
    const writes = [
        view.post('/leads', { customerName: 'Sneaky' }),
        view.patch(`/admissions/applications/${studentId}`, { intakeYear: 2030 }),
        view.put('/admissions/settings', { fees: [] }),
        view.delete(`/team/${business._id}`),
        view.post('/settings/password', { currentPassword: 'x', newPassword: 'y' }),
    ];
    for (const res of await Promise.all(writes)) {
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.code, 'READ_ONLY');
    }
    assert.strictEqual(await Lead.countDocuments(), before);
});

test('view tokens expire, and a deactivated super admin is shut out at once', async () => {
    const { business } = await twoWorkspaces();
    const token = await consoleToken();
    const admin = await PlatformAdmin.findOne();

    const expired = jwt.sign(
        { kind: 'platform-view', platformAdminId: String(admin._id), businessId: String(business._id), readOnly: true, exp: Math.floor(Date.now() / 1000) - 10 },
        process.env.JWT_SECRET,
        { audience: 'platform-view' }
    );
    assert.strictEqual((await asToken(expired).get('/leads')).status, 401);

    const view = await viewToken(token, business._id);
    await PlatformAdmin.updateOne({ _id: admin._id }, { $set: { isActive: false } });
    assert.strictEqual((await asToken(view).get('/leads')).status, 401);
    assert.strictEqual((await consoleApi(token).get('/workspaces')).status, 401);
});

test('feature switches and workspace views are audited', async () => {
    const { other } = await twoWorkspaces();
    const token = await consoleToken();
    const api = consoleApi(token);

    assert.strictEqual((await api.patch(`/workspaces/${other._id}/features`, { billing: true })).status, 400);
    const on = await api.patch(`/workspaces/${other._id}/features`, { admissions: true });
    assert.strictEqual(on.status, 200);
    assert.strictEqual(on.body.data.features.admissions, true);
    await viewToken(token, other._id);

    const logOfOther = await api.get('/audit', { businessId: String(other._id) });
    const actions = logOfOther.body.data.items.map((e) => e.action);
    assert.deepStrictEqual(actions, ['VIEW_WORKSPACE', 'FEATURE_CHANGED']);
    const view = logOfOther.body.data.items[0];
    assert.strictEqual(view.reason, 'Customer support check');
    assert.strictEqual(view.details.firstPath, '/dashboard');
    assert.strictEqual(view.admin.email, 'root@kelto.test');
    assert.deepStrictEqual(logOfOther.body.data.items[1].details, { feature: 'admissions', from: false, to: true });
});

test('normal people keep exactly their access', async () => {
    const { counsellorA } = await twoWorkspaces();
    await consoleToken();
    const res = await request(app).get('/api/leads').set(h.auth(counsellorA));
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.leads.every((l) => ['Lead A', 'Asha Nair'].includes(l.customerName)), 'a counsellor still sees only their own');
    const me = await request(app).get('/api/auth/me').set(h.auth(counsellorA));
    assert.strictEqual(me.body.data.access.readOnly, false);
});
