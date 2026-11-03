const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const makeTeam = async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER', name: 'Owner' });
    const manager = await h.makeUser(business, { role: 'SALES_MANAGER', name: 'Manager' });
    const teamMember = await h.makeUser(business, { role: 'SALESPERSON', managerId: manager._id, name: 'Team member' });
    const loner = await h.makeUser(business, { role: 'SALESPERSON', name: 'Loner' });
    return { business, owner, manager, teamMember, loner };
};

const names = (res) => res.body.data.counsellors.map((c) => c.name).sort();

test('admissions endpoints require authentication', async () => {
    const res = await request(app).get('/api/admissions/context');
    assert.strictEqual(res.status, 401);
});

test('a business without the admissions module gets 404', async () => {
    const business = await h.makeBusiness({ admissions: false });
    const owner = await h.makeUser(business, { role: 'OWNER' });

    const res = await request(app).get('/api/admissions/context').set(h.auth(owner));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.message, 'Admissions module is not enabled');
});

test('owner context includes the full configuration and every active staff member', async () => {
    const { owner } = await makeTeam();

    const res = await request(app).get('/api/admissions/context').set(h.auth(owner));

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.enabled, true);
    assert.strictEqual(res.body.data.isAdmin, true);
    assert.strictEqual(res.body.data.config.stages.length, 8);
    assert.strictEqual(res.body.data.config.timezone, 'Asia/Kolkata');
    assert.deepStrictEqual(names(res), ['Loner', 'Manager', 'Owner', 'Team member']);
});

test('manager sees themselves and their own salespeople only', async () => {
    const { manager } = await makeTeam();

    const res = await request(app).get('/api/admissions/context').set(h.auth(manager));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.isAdmin, false);
    assert.deepStrictEqual(names(res), ['Manager', 'Team member']);
});

test('salesperson sees only themselves', async () => {
    const { loner } = await makeTeam();

    const res = await request(app).get('/api/admissions/context').set(h.auth(loner));

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(names(res), ['Loner']);
});

test('deactivated staff are not offered as counsellors', async () => {
    const { business, owner } = await makeTeam();
    await h.makeUser(business, { role: 'SALESPERSON', name: 'Gone', isActive: false });

    const res = await request(app).get('/api/admissions/context').set(h.auth(owner));

    assert.ok(!names(res).includes('Gone'));
});
