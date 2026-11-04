// Customisable roles: built-in roles keep the old behaviour, custom roles get
// exactly what they are given, and the safety rules hold.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const Lead = require('../src/models/Leads');
const User = require('../src/models/User');
const { invalidateAccess } = require('../src/services/access');

before(h.startDb);
after(h.stopDb);
beforeEach(async () => {
    await h.resetDb();
    invalidateAccess();
});

const api = (user) => ({
    get: (path) => request(app).get(`/api${path}`).set(h.auth(user)),
    post: (path, body = {}) => request(app).post(`/api${path}`).set(h.auth(user)).send(body),
    patch: (path, body = {}) => request(app).patch(`/api${path}`).set(h.auth(user)).send(body),
    delete: (path, body = {}) => request(app).delete(`/api${path}`).set(h.auth(user)).send(body),
});

const lead = (business, owner, assignee, name) =>
    Lead.create({ businessId: business._id, customerName: name, createdBy: owner._id, assignedTo: assignee?._id ?? null });

const names = (res) => res.body.data.leads.map((l) => l.customerName).sort();

/** Owner, a manager, a salesperson under the manager, and one under the salesperson */
const company = async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER', name: 'Owner' });
    const manager = await h.makeUser(business, { role: 'SALES_MANAGER', name: 'Manager' });
    const rep = await h.makeUser(business, { role: 'SALESPERSON', name: 'Rep', managerId: manager._id });
    const junior = await h.makeUser(business, { role: 'SALESPERSON', name: 'Junior', managerId: rep._id });
    const other = await h.makeUser(business, { role: 'SALESPERSON', name: 'Other' });
    await lead(business, owner, owner, 'L-owner');
    await lead(business, owner, manager, 'L-manager');
    await lead(business, owner, rep, 'L-rep');
    await lead(business, owner, junior, 'L-junior');
    await lead(business, owner, other, 'L-other');
    await lead(business, owner, null, 'L-unassigned');
    return { business, owner, manager, rep, junior, other };
};

const roleIdByKey = async (owner, key) => {
    const res = await api(owner).get('/roles');
    return res.body.data.find((r) => r.key === key)._id;
};

test('built-in roles see what they saw before: own, team (any depth), everything', async () => {
    const { owner, manager, rep } = await company();

    assert.deepStrictEqual(names(await api(rep).get('/leads?limit=50')), ['L-rep']);
    assert.deepStrictEqual(names(await api(manager).get('/leads?limit=50')), ['L-junior', 'L-manager', 'L-rep']);
    assert.strictEqual((await api(owner).get('/leads?limit=50')).body.data.leads.length, 6);
});

test('only people with "assign" can give leads to others, and only inside their scope', async () => {
    const { owner, manager, rep, other } = await company();

    const mine = await api(rep).post('/leads', { customerName: 'Rep lead', assignedTo: other._id });
    assert.strictEqual(mine.status, 201);
    assert.strictEqual(String(mine.body.data.lead?.assignedTo?._id ?? mine.body.data.assignedTo?._id ?? mine.body.data.assignedTo), String(rep._id));

    const leadId = (await Lead.findOne({ customerName: 'L-rep' }))._id;
    assert.strictEqual((await api(rep).patch(`/leads/${leadId}`, { assignedTo: other._id })).status, 403);
    assert.strictEqual((await api(manager).patch(`/leads/${leadId}`, { assignedTo: other._id })).status, 403);
    assert.strictEqual((await api(manager).patch(`/leads/${leadId}`, { assignedTo: manager._id })).status, 200);
    assert.strictEqual((await api(manager).patch(`/leads/${leadId}`, { assignedTo: null })).status, 403);
    assert.strictEqual((await api(owner).patch(`/leads/${leadId}`, { assignedTo: null })).status, 200);
});

test('the owner sees the built-in roles with member counts; others cannot manage roles', async () => {
    const { owner, rep } = await company();

    const list = await api(owner).get('/roles');
    assert.strictEqual(list.status, 200);
    const byKey = Object.fromEntries(list.body.data.map((r) => [r.key, r]));
    assert.strictEqual(byKey.OWNER.memberCount, 1);
    assert.strictEqual(byKey.SALES_MANAGER.memberCount, 1);
    assert.strictEqual(byKey.SALESPERSON.memberCount, 3);
    assert.strictEqual(byKey.OWNER.grantable, false);

    assert.strictEqual((await api(rep).get('/roles')).status, 403);
    assert.strictEqual((await api(rep).post('/roles', { name: 'Hacker', permissions: ['team.edit'] })).status, 403);
});

test('a custom role gets exactly what it is given, and every action checks it', async () => {
    const { owner, rep } = await company();

    const created = await api(owner).post('/roles', {
        name: 'Receptionist',
        permissions: ['leads.create'],
        scopes: { leads: 'own' },
    });
    assert.strictEqual(created.status, 201);
    // Adding leads needs seeing them
    assert.deepStrictEqual(created.body.data.permissions, ['leads.view', 'leads.create']);

    assert.strictEqual((await api(owner).patch(`/team/${rep._id}`, { roleId: created.body.data._id })).status, 200);

    assert.strictEqual((await api(rep).post('/leads', { customerName: 'Walk-in' })).status, 201);
    const leadId = (await Lead.findOne({ customerName: 'L-rep' }))._id;
    assert.strictEqual((await api(rep).patch(`/leads/${leadId}`, { notes: 'x' })).status, 403);
    assert.strictEqual((await api(rep).delete(`/leads/${leadId}`)).status, 403);
    assert.strictEqual((await api(rep).get('/follow-ups')).status, 403);
    assert.strictEqual((await api(rep).get('/pipeline')).status, 403);
    assert.strictEqual((await api(rep).get('/dashboard/summary')).status, 403);

    const me = await api(rep).get('/auth/me');
    assert.strictEqual(me.body.data.access.roleName, 'Receptionist');
    assert.deepStrictEqual(me.body.data.access.permissions, ['leads.view', 'leads.create']);
});

test('changing a role applies on the next request, with the same sign-in', async () => {
    const { owner, rep } = await company();
    const role = (await api(owner).post('/roles', { name: 'Viewer', permissions: ['leads.view'] })).body.data;
    await api(owner).patch(`/team/${rep._id}`, { roleId: role._id });

    assert.strictEqual((await api(rep).get('/follow-ups')).status, 403);
    assert.strictEqual((await api(owner).patch(`/roles/${role._id}`, { permissions: ['leads.view', 'followups.view'] })).status, 200);
    assert.strictEqual((await api(rep).get('/follow-ups')).status, 200);
});

test('a data scope can be widened: "all" shows every lead, including unassigned', async () => {
    const { owner, rep } = await company();
    const role = (await api(owner).post('/roles', { name: 'Auditor', permissions: ['leads.view'], scopes: { leads: 'all' } })).body.data;
    await api(owner).patch(`/team/${rep._id}`, { roleId: role._id });

    assert.strictEqual((await api(rep).get('/leads?limit=50')).body.data.leads.length, 6);
});

test('custom admissions role: payments only, no recording or moving', async () => {
    const { business, owner, rep } = await company();
    business.features = { admissions: true };
    await business.save();
    const role = (await api(owner).post('/roles', { name: 'Accountant', permissions: ['admissions.payments'], scopes: { admissions: 'all' } })).body.data;
    assert.deepStrictEqual(role.permissions, ['admissions.view', 'admissions.payments']);
    await api(owner).patch(`/team/${rep._id}`, { roleId: role._id });

    assert.strictEqual((await api(rep).get('/admissions/payments')).status, 200);
    assert.strictEqual((await api(rep).get('/admissions/settings')).status, 403);
    assert.strictEqual((await api(rep).post('/admissions/applications', {})).status, 403);
});

test('the Owner role is locked, built-in roles cannot be deleted', async () => {
    const { owner } = await company();
    const ownerRole = await roleIdByKey(owner, 'OWNER');
    const salesRole = await roleIdByKey(owner, 'SALESPERSON');

    assert.strictEqual((await api(owner).patch(`/roles/${ownerRole}`, { permissions: [] })).status, 400);
    assert.strictEqual((await api(owner).delete(`/roles/${salesRole}`)).status, 400);
    assert.strictEqual((await api(owner).patch(`/roles/${salesRole}`, { name: 'Counsellor' })).status, 200);
});

test('deleting a role in use asks where its people go, then moves them', async () => {
    const { owner, rep, junior } = await company();
    const temp = (await api(owner).post('/roles', { name: 'Temp', permissions: ['leads.view'] })).body.data;
    const keep = (await api(owner).post('/roles', { name: 'Keep', permissions: ['followups.view'] })).body.data;
    await api(owner).patch(`/team/${rep._id}`, { roleId: temp._id });
    await api(owner).patch(`/team/${junior._id}`, { roleId: temp._id });

    const blocked = await api(owner).delete(`/roles/${temp._id}`);
    assert.strictEqual(blocked.status, 400);
    assert.strictEqual(blocked.body.code, 'ROLE_IN_USE');
    assert.strictEqual(blocked.body.memberCount, 2);

    assert.strictEqual((await api(owner).delete(`/roles/${temp._id}`, { reassignTo: keep._id })).status, 200);
    assert.strictEqual(String((await User.findById(rep._id)).roleId), String(keep._id));
    assert.strictEqual((await api(rep).get('/follow-ups')).status, 200);
});

test('nobody can hand out more access than they have', async () => {
    const { owner, manager, rep } = await company();
    // A manager allowed to manage roles and the team, but not to delete people
    const roleAdmin = (
        await api(owner).post('/roles', {
            name: 'Role admin',
            permissions: ['settings.roles', 'team.view', 'team.edit', 'leads.view'],
            scopes: { leads: 'team' },
        })
    ).body.data;
    await api(owner).patch(`/team/${manager._id}`, { roleId: roleAdmin._id });

    assert.strictEqual((await api(manager).post('/roles', { name: 'Too much', permissions: ['team.delete'] })).status, 403);
    assert.strictEqual((await api(manager).post('/roles', { name: 'Wider', permissions: ['leads.view'], scopes: { leads: 'all' } })).status, 403);
    assert.strictEqual((await api(manager).post('/roles', { name: 'Fine', permissions: ['leads.view'], scopes: { leads: 'team' } })).status, 201);
    assert.strictEqual((await api(manager).patch(`/roles/${roleAdmin._id}`, { name: 'Mine' })).status, 403);

    // Someone whose role has more access than mine is out of my reach
    assert.strictEqual((await api(manager).patch(`/team/${rep._id}`, { name: 'Renamed' })).status, 403);
    // The Owner role is never given through the team page, even by the owner
    const ownerRole = await roleIdByKey(owner, 'OWNER');
    assert.strictEqual((await api(owner).patch(`/team/${rep._id}`, { roleId: ownerRole })).status, 400);
});

test('team rules: no reporting loops, no editing yourself, deactivation takes effect at once', async () => {
    const { owner, manager, rep, junior } = await company();

    assert.strictEqual((await api(owner).patch(`/team/${manager._id}`, { managerId: junior._id })).status, 400);
    assert.strictEqual((await api(owner).patch(`/team/${rep._id}`, { managerId: rep._id })).status, 400);
    assert.strictEqual((await api(owner).patch(`/team/${rep._id}`, { managerId: null })).status, 200);

    const editor = (await api(owner).post('/roles', { name: 'Team editor', permissions: ['team.edit'] })).body.data;
    await api(owner).patch(`/team/${manager._id}`, { roleId: editor._id });
    assert.strictEqual((await api(manager).patch(`/team/${manager._id}`, { name: 'Boss' })).status, 403);

    assert.strictEqual((await api(rep).get('/leads')).status, 200);
    assert.strictEqual((await api(owner).patch(`/team/${rep._id}/deactivate`)).status, 200);
    assert.strictEqual((await api(rep).get('/leads')).status, 401);
});

test('the assignable list follows the assign permission and scope', async () => {
    const { owner, manager, rep } = await company();

    const forRep = await api(rep).get('/roles/assignable/leads');
    assert.deepStrictEqual(forRep.body.data.map((p) => p.name), ['Rep']);

    const forManager = await api(manager).get('/roles/assignable/leads');
    assert.deepStrictEqual(forManager.body.data.map((p) => p.name).sort(), ['Junior', 'Manager', 'Rep']);

    const forOwner = await api(owner).get('/roles/assignable/leads');
    assert.strictEqual(forOwner.body.data.length, 5);
});
