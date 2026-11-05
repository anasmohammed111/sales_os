// Kelto admin (Milestone 1): platform roles and administrators, company
// suspension, and support sessions (view as owner, view as a person, support edit).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const h = require('./helpers');
const app = require('../src/app');
const Lead = require('../src/models/Leads');
const Business = require('../src/models/Business');
const PlatformAdmin = require('../src/models/PlatformAdmin');
const PlatformAuditLog = require('../src/models/PlatformAuditLog');
const SupportSession = require('../src/models/SupportSession');
const { resetLoginLimiter } = require('../src/controllers/platformController');
const { issueFileLink } = require('../src/services/storage/uploads');

before(h.startDb);
after(h.stopDb);
beforeEach(async () => {
    await h.resetDb();
    resetLoginLimiter();
});

const PASSWORD = 'Correct-Horse-Battery-9';

const makeAdmin = async ({ email = 'root@kelto.test', role, ...extra } = {}) =>
    PlatformAdmin.create({ name: email.split('@')[0], email, role, password: await bcrypt.hash(PASSWORD, 4), ...extra });

const signIn = (email = 'root@kelto.test', password = PASSWORD) => request(app).post('/api/platform/auth/login').send({ email, password });

const tokenFor = async (email, role) => {
    await makeAdmin({ email, role });
    const res = await signIn(email);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    return res.body.data.token;
};

const as = (token) => ({
    get: (path, query = {}) => request(app).get(`/api${path}`).query(query).set('Authorization', `Bearer ${token}`),
    post: (path, body = {}) => request(app).post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (path, body = {}) => request(app).put(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
    delete: (path) => request(app).delete(`/api${path}`).set('Authorization', `Bearer ${token}`),
});
const asUser = (user) => as(h.auth(user).Authorization.slice(7));

/** One company with an owner, a manager, two counsellors, leads and a student; and a second company. */
const companies = async () => {
    const team = await h.makeAdmissionsTeam();
    await Business.updateOne({ _id: team.business._id }, { $set: { owner: team.owner._id } });
    const other = await h.makeBusiness({ name: 'Other Agency', admissions: false });
    const otherOwner = await h.makeUser(other, { role: 'OWNER', name: 'Other Owner' });
    const lead = (business, owner, assignee, name) =>
        Lead.create({ businessId: business._id, customerName: name, createdBy: owner._id, assignedTo: assignee._id });
    const leadA = await lead(team.business, team.owner, team.counsellorA, 'Lead A');
    await lead(team.business, team.owner, team.counsellorB, 'Lead B');
    await lead(other, otherOwner, otherOwner, 'Other lead');
    return { ...team, other, otherOwner, leadA };
};

/** Starts a support session in the admin app and exchanges its code like the CRM does. */
const openSession = async (consoleToken, businessId, body) => {
    const started = await as(consoleToken).post(`/platform/workspaces/${businessId}/support-sessions`, { reason: 'Customer support check', ...body });
    if (started.status !== 201) return { started };
    const exchanged = await request(app).post('/api/support/exchange').send({ code: started.body.data.handoffCode });
    return { started, exchanged, token: exchanged.body.data?.token, code: started.body.data.handoffCode };
};

// --- Platform administrators and roles ---------------------------------------------

test('no HTTP route can create a platform administrator without admins.manage', async () => {
    const { owner } = await companies();
    for (const res of await Promise.all([
        request(app).post('/api/platform/admins').send({ email: 'x@y.z', name: 'X', role: 'SUPER_ADMIN' }),
        request(app).post('/api/platform/admins').set(h.auth(owner)).send({ email: 'x@y.z', name: 'X', role: 'SUPER_ADMIN' }),
    ])) {
        assert.strictEqual(res.status, 401);
    }
    const support = await tokenFor('support@kelto.test', 'SUPPORT_ADMIN');
    const res = await as(support).post('/platform/admins', { email: 'x@y.z', name: 'X', role: 'SUPER_ADMIN' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'PLATFORM_PERMISSION_DENIED');
    assert.strictEqual(await PlatformAdmin.countDocuments(), 1);
});

test('sign-in returns the role and permissions; five wrong passwords lock the account', async () => {
    await makeAdmin();
    const ok = await signIn();
    assert.strictEqual(ok.body.data.admin.role, 'SUPER_ADMIN', 'accounts without a role are the original super admin');
    assert.ok(ok.body.data.admin.permissions.includes('admins.manage'));
    for (let i = 0; i < 5; i += 1) await signIn('root@kelto.test', 'wrong');
    assert.strictEqual((await signIn()).status, 423);
});

test('each role can only do what it allows, on the server', async () => {
    const { business } = await companies();
    const auditor = as(await tokenFor('auditor@kelto.test', 'AUDITOR'));
    const support = as(await tokenFor('support@kelto.test', 'SUPPORT_ADMIN'));

    assert.strictEqual((await auditor.get('/platform/workspaces')).status, 200);
    assert.strictEqual((await auditor.get('/platform/audit')).status, 200);
    assert.strictEqual((await auditor.post(`/platform/workspaces/${business._id}/suspend`, { reason: 'Testing roles' })).status, 403);
    assert.strictEqual((await auditor.patch(`/platform/workspaces/${business._id}/features`, { admissions: false })).status, 403);
    assert.strictEqual((await auditor.post(`/platform/workspaces/${business._id}/support-sessions`, { mode: 'VIEW_OWNER', reason: 'Looking around' })).status, 403);

    assert.strictEqual((await support.post(`/platform/workspaces/${business._id}/support-sessions`, { mode: 'VIEW_OWNER', reason: 'Customer asked' })).status, 201);
    const edit = await support.post(`/platform/workspaces/${business._id}/support-sessions`, { mode: 'SUPPORT_EDIT', reason: 'Fix a lead', allowedPermissions: ['leads.edit'] });
    assert.strictEqual(edit.status, 403, 'support edits need the elevated support.edit permission');
    assert.strictEqual((await support.get('/platform/admins')).status, 403);
    assert.strictEqual((await support.get('/platform/audit')).status, 403);
});

test('a new administrator gets a temporary password that must be changed; old sessions are revoked', async () => {
    const root = as(await tokenFor('root@kelto.test', 'SUPER_ADMIN'));
    const created = await root.post('/platform/admins', { name: 'Sam Support', email: 'sam@kelto.test', role: 'SUPPORT_ADMIN' });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const temporary = created.body.data.temporaryPassword;
    assert.ok(temporary.length >= 16);
    assert.ok(!JSON.stringify((await root.get('/platform/admins')).body).includes(temporary), 'never shown again');

    const first = await signIn('sam@kelto.test', temporary);
    assert.strictEqual(first.body.data.admin.mustChangePassword, true);
    const sam = as(first.body.data.token);
    const blocked = await sam.get('/platform/workspaces');
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

    assert.strictEqual((await sam.post('/platform/auth/change-password', { currentPassword: temporary, newPassword: 'short' })).status, 400);
    const changed = await sam.post('/platform/auth/change-password', { currentPassword: temporary, newPassword: 'A-much-longer-passphrase' });
    assert.strictEqual(changed.status, 200);
    assert.strictEqual((await sam.get('/platform/workspaces')).status, 401, 'the old token is revoked');
    assert.strictEqual((await as(changed.body.data.token).get('/platform/workspaces')).status, 200);
});

test('administrators cannot escalate or lock everyone out', async () => {
    const root = as(await tokenFor('root@kelto.test', 'SUPER_ADMIN'));
    const me = await PlatformAdmin.findOne({ email: 'root@kelto.test' });

    assert.strictEqual((await root.patch(`/platform/admins/${me._id}`, { role: 'AUDITOR' })).status, 403, 'not your own role');
    assert.strictEqual((await root.patch(`/platform/admins/${me._id}`, { isActive: false })).status, 403, 'not yourself');

    const second = await makeAdmin({ email: 'second@kelto.test', role: 'PLATFORM_ADMIN' });
    const secondToken = (await signIn('second@kelto.test')).body.data.token;
    // A platform admin cannot manage administrators (no admins.manage)
    assert.strictEqual((await as(secondToken).patch(`/platform/admins/${me._id}`, { role: 'AUDITOR' })).status, 403);

    // Changing someone's role signs them out
    assert.strictEqual((await root.patch(`/platform/admins/${second._id}`, { role: 'AUDITOR' })).status, 200);
    assert.strictEqual((await as(secondToken).get('/platform/workspaces')).status, 401);

    // Reset and revoke both cut existing sessions
    const third = await makeAdmin({ email: 'third@kelto.test', role: 'SUPPORT_ADMIN' });
    const thirdToken = (await signIn('third@kelto.test')).body.data.token;
    const reset = await root.post(`/platform/admins/${third._id}/reset-password`);
    assert.ok(reset.body.data.temporaryPassword);
    assert.strictEqual((await as(thirdToken).get('/platform/auth/me')).status, 401);

    const history = await root.get(`/platform/admins/${third._id}/logins`);
    assert.ok(history.body.data.items.some((e) => e.action === 'LOGIN'));
});

// --- Company suspension -------------------------------------------------------------

test('suspending a company cuts every signed-in person off immediately, and reactivating restores access', async () => {
    const { business, owner, counsellorA } = await companies();
    const root = as(await tokenFor('root@kelto.test', 'SUPER_ADMIN'));
    const ownerApi = asUser(owner);
    assert.strictEqual((await ownerApi.get('/leads')).status, 200, 'warm the access cache');

    assert.strictEqual((await root.post(`/platform/workspaces/${business._id}/suspend`, { reason: 'no' })).status, 400, 'a reason is required');
    const suspended = await root.post(`/platform/workspaces/${business._id}/suspend`, { reason: 'Unpaid invoice' });
    assert.strictEqual(suspended.status, 200);
    assert.strictEqual(suspended.body.data.status, 'SUSPENDED');

    for (const path of ['/leads', '/follow-ups', '/quotation', '/pipeline', '/dashboard/summary', '/admissions/context', '/settings', '/auth/me', '/notifications']) {
        const res = await ownerApi.get(path);
        assert.strictEqual(res.status, 403, `${path} -> ${res.status}`);
        assert.strictEqual(res.body.code, 'COMPANY_SUSPENDED', path);
    }
    assert.strictEqual((await asUser(counsellorA).post('/leads', { customerName: 'X' })).status, 403);
    const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: h.PASSWORD });
    assert.strictEqual(login.status, 403);

    const link = await issueFileLink({
        claims: { kind: 'document', docId: String(business._id), businessId: String(business._id) },
        storageKey: 'x',
        filename: 'x.pdf',
        mimeType: 'application/pdf',
    });
    const file = await request(app).get(link.url);
    assert.strictEqual(file.status, 403, 'file links stop working too');

    assert.strictEqual((await root.post(`/platform/workspaces/${business._id}/reactivate`, { reason: 'Invoice paid' })).status, 200);
    assert.strictEqual((await ownerApi.get('/leads')).status, 200);

    const actions = (await PlatformAuditLog.find({ businessId: business._id }).sort({ createdAt: 1 })).map((e) => e.action);
    assert.deepStrictEqual(actions, ['COMPANY_SUSPENDED', 'COMPANY_REACTIVATED']);
});

// --- Support sessions -------------------------------------------------------------------

test('view as owner: everything is visible, nothing can change, and the code works once', async () => {
    const { business } = await companies();
    const root = await tokenFor('root@kelto.test', 'SUPER_ADMIN');
    const { exchanged, token, code } = await openSession(root, business._id, { mode: 'VIEW_OWNER', landingPath: '/leads' });
    assert.strictEqual(exchanged.status, 200, JSON.stringify(exchanged.body));
    assert.strictEqual(exchanged.body.data.landingPath, '/leads');
    assert.strictEqual((await request(app).post('/api/support/exchange').send({ code })).status, 401, 'single use');

    const view = as(token);
    const leads = await view.get('/leads');
    assert.deepStrictEqual(leads.body.data.leads.map((l) => l.customerName).sort(), ['Lead A', 'Lead B']);
    const me = await view.get('/auth/me');
    assert.strictEqual(me.body.data.user.name, 'Owner', 'sees the real owner');
    assert.strictEqual(me.body.data.access.readOnly, true);
    assert.strictEqual(me.body.data.support.mode, 'VIEW_OWNER');
    assert.strictEqual(me.body.data.support.adminName, 'root');
    assert.ok(!me.body.data.access.permissions.includes('leads.create'));

    for (const res of await Promise.all([view.post('/leads', { customerName: 'X' }), view.patch(`/leads/${(await Lead.findOne())._id}`, { priority: 'HIGH' })])) {
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.code, 'READ_ONLY');
    }
    assert.strictEqual((await view.get('/platform/workspaces')).status, 401, 'no nested access to the admin API');
});

test('view as a person reproduces exactly their access and records', async () => {
    const { business, counsellorA } = await companies();
    const root = await tokenFor('root@kelto.test', 'SUPER_ADMIN');
    const { token } = await openSession(root, business._id, { mode: 'VIEW_USER', userId: String(counsellorA._id) });
    const view = as(token);

    const leads = await view.get('/leads');
    assert.ok(leads.body.data.leads.every((l) => ['Lead A', 'Asha Nair'].includes(l.customerName)), 'own scope only');
    const me = await view.get('/auth/me');
    assert.strictEqual(me.body.data.user.name, 'Counsellor A');
    assert.strictEqual(me.body.data.access.roleName, 'Salesperson');
    assert.ok(!me.body.data.access.permissions.includes('team.view'), 'no extra permissions');
    assert.strictEqual((await view.get('/team')).status, 403);
});

test('support edit needs the owner, allows only the listed changes, and is attributed to the administrator', async () => {
    const { business, owner, leadA } = await companies();
    const root = await tokenFor('root@kelto.test', 'SUPER_ADMIN');
    const admin = await PlatformAdmin.findOne({ email: 'root@kelto.test' });

    const refused = await openSession(root, business._id, { mode: 'SUPPORT_EDIT', allowedPermissions: ['leads.edit'] });
    assert.strictEqual(refused.started.status, 409);
    assert.strictEqual(refused.started.body.code, 'OWNER_AUTHORIZATION_REQUIRED');

    // The owner allows support edits for 24 hours (in their own workspace)
    const granted = await asUser(owner).put('/settings/support-access', { hours: 24 });
    assert.strictEqual(granted.status, 200, JSON.stringify(granted.body));
    assert.ok(granted.body.data.editAllowedUntil);

    const bad = await openSession(root, business._id, { mode: 'SUPPORT_EDIT', allowedPermissions: ['team.delete'] });
    assert.strictEqual(bad.started.status, 400, 'only from the allowed list');

    const { token } = await openSession(root, business._id, { mode: 'SUPPORT_EDIT', allowedPermissions: ['leads.edit'] });
    const editor = as(token);
    const changed = await editor.patch(`/leads/${leadA._id}`, { status: 'CONTACTED' });
    assert.strictEqual(changed.status, 200, JSON.stringify(changed.body));
    const stored = await Lead.findById(leadA._id);
    assert.strictEqual(String(stored.statusHistory.at(-1).changedBy), String(admin._id), 'recorded against the administrator');
    assert.notStrictEqual(String(stored.statusHistory.at(-1).changedBy), String(owner._id));

    assert.strictEqual((await editor.post('/leads', { customerName: 'Not allowed' })).status, 403, 'creating was not allowed');
    const password = await editor.post('/settings/password', { currentPassword: 'x', newPassword: 'y' });
    assert.strictEqual(password.body.code, 'SUPPORT_NOT_ALLOWED');
    assert.strictEqual((await editor.put('/settings/support-access', { hours: 72 })).status, 403);

    const audited = await PlatformAuditLog.findOne({ action: 'SUPPORT_ACTION' });
    assert.strictEqual(String(audited.platformAdminId), String(admin._id));
    assert.strictEqual(audited.details.path, `/api/leads/${leadA._id}`);

    // The owner withdraws permission: the session stops at once
    await asUser(owner).put('/settings/support-access', { hours: 0 });
    const after = await editor.get('/leads');
    assert.strictEqual(after.status, 401);
    assert.strictEqual(after.body.code, 'SUPPORT_SESSION_ENDED');
});

test('sessions can be ended or revoked at once, and an administrator has one at a time', async () => {
    const { business } = await companies();
    const root = await tokenFor('root@kelto.test', 'SUPER_ADMIN');
    const first = await openSession(root, business._id, { mode: 'VIEW_OWNER' });
    const second = await openSession(root, business._id, { mode: 'VIEW_OWNER' });
    assert.strictEqual((await as(first.token).get('/leads')).status, 401, 'starting a new session ends the previous one');
    assert.strictEqual((await as(second.token).get('/leads')).status, 200);

    const sessions = await as(root).get('/platform/support-sessions', { status: 'ACTIVE' });
    assert.strictEqual(sessions.body.data.items.length, 1);

    // Another administrator revokes it
    const other = await tokenFor('platform@kelto.test', 'PLATFORM_ADMIN');
    const id = sessions.body.data.items[0].id;
    assert.strictEqual((await as(other).post(`/platform/support-sessions/${id}/revoke`, { reason: 'x' })).status, 400, 'reason needed');
    assert.strictEqual((await as(other).post(`/platform/support-sessions/${id}/revoke`, { reason: 'Security review' })).status, 200);
    assert.strictEqual((await as(second.token).get('/leads')).status, 401);

    // Ending from the workspace (the banner's Exit)
    const third = await openSession(root, business._id, { mode: 'VIEW_OWNER' });
    assert.strictEqual((await as(third.token).post('/support/end')).status, 200);
    assert.strictEqual((await as(third.token).get('/leads')).status, 401);

    // Expired sessions are refused
    const fourth = await openSession(root, business._id, { mode: 'VIEW_OWNER' });
    await SupportSession.updateOne({ status: 'ACTIVE' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.strictEqual((await as(fourth.token).get('/leads')).status, 401);
});

test('forged and foreign tokens are refused everywhere', async () => {
    const { owner } = await companies();
    const root = await tokenFor('root@kelto.test', 'SUPER_ADMIN');
    assert.strictEqual((await as(root).get('/leads')).status, 401, 'console token in the CRM');
    assert.strictEqual((await asUser(owner).get('/platform/workspaces')).status, 401, 'CRM token in the admin API');
    const forged = jwt.sign({ kind: 'support', sessionId: '0'.repeat(24), mode: 'SUPPORT_EDIT' }, 'not-the-secret', { audience: 'support' });
    assert.strictEqual((await as(forged).get('/leads')).status, 401);
    assert.strictEqual((await as(forged).post('/settings/password', {})).status, 403, 'blocked before it is even verified');
});

test('normal people keep exactly their access', async () => {
    const { counsellorA } = await companies();
    const res = await asUser(counsellorA).get('/leads');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.leads.every((l) => ['Lead A', 'Asha Nair'].includes(l.customerName)));
    const me = await asUser(counsellorA).get('/auth/me');
    assert.strictEqual(me.body.data.access.readOnly, false);
    assert.strictEqual(me.body.data.support, undefined);
});
