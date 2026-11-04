const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const Business = require('../src/models/Business');
const User = require('../src/models/User');
const Lead = require('../src/models/Leads');
const University = require('../src/models/University');
const AdmissionConfig = require('../src/models/AdmissionConfig');
const AdmissionApplication = require('../src/models/AdmissionApplication');
const { seedSyb, generatePassword } = require('../src/seed/seedSyb');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

test('generated passwords are long and mixed', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i += 1) {
        const p = generatePassword();
        assert.ok(p.length >= 16);
        assert.match(p, /[A-Z]/);
        assert.match(p, /[a-z]/);
        assert.match(p, /[0-9]/);
        seen.add(p);
    }
    assert.strictEqual(seen.size, 50);
});

test('seeding creates the SYB business, admin and team, with admissions switched on and no sample students', async () => {
    const result = await seedSyb();

    assert.deepStrictEqual(
        result.created.map((u) => [u.email, u.role]),
        [
            ['admin@syb.local', 'OWNER'],
            ['manager@syb.local', 'SALES_MANAGER'],
            ['counsellor1@syb.local', 'SALESPERSON'],
            ['counsellor2@syb.local', 'SALESPERSON'],
        ]
    );

    const business = await Business.findOne({ businessName: 'SYB Education' });
    assert.strictEqual(business.features.admissions, true);
    assert.strictEqual(business.currency, 'INR');
    const admin = await User.findOne({ email: 'admin@syb.local' });
    assert.strictEqual(business.owner.toString(), admin._id.toString());

    const manager = await User.findOne({ email: 'manager@syb.local' });
    const counsellor = await User.findOne({ email: 'counsellor1@syb.local' });
    assert.strictEqual(counsellor.managerId.toString(), manager._id.toString());

    assert.strictEqual(await AdmissionConfig.countDocuments({ businessId: business._id }), 1);
    assert.ok((await University.countDocuments({ businessId: business._id })) >= 8);
    assert.strictEqual(await Lead.countDocuments({}), 0);
    assert.strictEqual(await AdmissionApplication.countDocuments({}), 0);

    // The printed password really works
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@syb.local', password: result.created[0].password });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
});

test('running the seed again changes nothing and reveals no passwords', async () => {
    const first = await seedSyb();
    const adminBefore = await User.findOne({ email: 'admin@syb.local' });

    const second = await seedSyb();

    assert.deepStrictEqual(second.created, []);
    assert.strictEqual(second.existing.length, 4);
    assert.strictEqual(await Business.countDocuments({}), 1);
    assert.strictEqual(await User.countDocuments({}), 4);
    assert.strictEqual(await University.countDocuments({}), first.universitiesAdded);
    const adminAfter = await User.findOne({ email: 'admin@syb.local' });
    assert.strictEqual(adminAfter.password, adminBefore.password);
});

test('the seed never takes over an email used by another business', async () => {
    const other = await h.makeBusiness({ name: 'Someone else' });
    await User.create({ businessId: other._id, name: 'Taken', email: 'manager@syb.local', password: 'x'.repeat(60), role: 'OWNER' });

    const result = await seedSyb();

    assert.ok(!result.created.some((u) => u.email === 'manager@syb.local'));
    assert.ok(result.skipped.includes('manager@syb.local'));
    const taken = await User.findOne({ email: 'manager@syb.local' });
    assert.strictEqual(taken.businessId.toString(), other._id.toString());
    // Counsellors still get created, just without that manager
    const counsellor = await User.findOne({ email: 'counsellor1@syb.local' });
    assert.strictEqual(counsellor.managerId, null);
});
