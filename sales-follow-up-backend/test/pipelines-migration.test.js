const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const Lead = require('../src/models/Leads');
const Pipeline = require('../src/models/Pipeline');
const migration = require('../src/migrations/004-sales-pipelines');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

test('the migration gives every company its first pipeline and every lead a pipelineId, and can run twice', async () => {
    const companies = [];
    for (const name of ['North', 'South']) {
        const business = await h.makeBusiness({ name });
        const owner = await h.makeUser(business, { role: 'OWNER' });
        for (const status of ['NEGOTIATION', 'ADMISSIONS']) {
            await Lead.create({ businessId: business._id, customerName: `${name} ${status}`, status, createdBy: owner._id });
        }
        companies.push(business);
    }
    // "Neglected leads" reads updatedAt: moving leads onto a pipeline must not look like activity
    await Lead.collection.updateMany({}, { $set: { updatedAt: new Date('2026-01-01T00:00:00Z') } });

    await migration.up();
    await migration.up();

    for (const business of companies) {
        const owned = await Pipeline.find({ businessId: business._id });
        assert.strictEqual(owned.length, 1);
        assert.strictEqual(owned[0].name, 'Sales pipeline');
        const leads = await Lead.find({ businessId: business._id }).sort({ customerName: 1 });
        assert.ok(leads.every((l) => String(l.pipelineId) === String(owned[0]._id)));
        assert.deepStrictEqual(leads.map((l) => l.status), ['ADMISSIONS', 'NEGOTIATION']);
    }
    assert.strictEqual(await Lead.countDocuments({ pipelineId: null }), 0);
    assert.strictEqual(await Lead.countDocuments({ updatedAt: { $ne: new Date('2026-01-01T00:00:00Z') } }), 0);
});

test('a newly registered company starts with the standard seven stages', async () => {
    const res = await request(app).post('/api/auth/register').send({
        businessName: 'Fresh Start Ltd',
        name: 'Founder',
        email: 'founder@fresh.test',
        password: 'Password123!',
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));

    const owned = await Pipeline.find({ businessId: res.body.data.business._id ?? res.body.data.business.id });
    assert.strictEqual(owned.length, 1);
    assert.deepStrictEqual(owned[0].stages.map((s) => s.key), ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTATION_SENT', 'NEGOTIATION', 'WON', 'LOST']);
});

test('only the owner can set up pipelines by default', async () => {
    const business = await h.makeBusiness();
    const permissionsOf = async (role) => {
        const user = await h.makeUser(business, { role });
        const me = await request(app).get('/api/auth/me').set(h.auth(user));
        assert.strictEqual(me.status, 200, JSON.stringify(me.body));
        return me.body.data.access.permissions;
    };

    assert.ok((await permissionsOf('OWNER')).includes('settings.pipelines'));
    assert.ok(!(await permissionsOf('SALES_MANAGER')).includes('settings.pipelines'));
    assert.ok(!(await permissionsOf('SALESPERSON')).includes('settings.pipelines'));
});
