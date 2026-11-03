const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const User = require('../src/models/User');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const api = (user) => ({
    get: (path) => request(app).get(`/api/settings${path}`).set(h.auth(user)),
    patch: (path, body) => request(app).patch(`/api/settings${path}`).set(h.auth(user)).send(body),
    post: (path, body) => request(app).post(`/api/settings${path}`).set(h.auth(user)).send(body),
});

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

test('settings require sign-in', async () => {
    assert.strictEqual((await request(app).get('/api/settings')).status, 401);
});

test('settings return my profile, the business and enabled features', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER', name: 'Founder' });

    const res = await api(owner).get('');

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.profile.name, 'Founder');
    assert.strictEqual(res.body.data.profile.role, 'OWNER');
    assert.strictEqual(res.body.data.profile.hasPassword, true);
    assert.strictEqual(res.body.data.business.businessName, business.businessName);
    assert.strictEqual(res.body.data.business.currency, 'USD');
    assert.strictEqual(res.body.data.features.admissions, true);
    assert.strictEqual(JSON.stringify(res.body).includes('password"'), false);
});

test('anyone can update their own name and phone, but not their role or email', async () => {
    const business = await h.makeBusiness();
    const member = await h.makeUser(business, { role: 'SALESPERSON' });

    const res = await api(member).patch('/profile', { name: '  Anu Joseph ', phone: '+91 90000 11111', role: 'OWNER', email: 'x@y.com' });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const saved = await User.findById(member._id);
    assert.strictEqual(saved.name, 'Anu Joseph');
    assert.strictEqual(saved.phone, '+91 90000 11111');
    assert.strictEqual(saved.role, 'SALESPERSON');
    assert.strictEqual(saved.email, member.email);

    assert.strictEqual((await api(member).patch('/profile', { name: 'A' })).status, 400);
});

test('only the owner can change business details, and they are validated', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const manager = await h.makeUser(business, { role: 'SALES_MANAGER' });

    assert.strictEqual((await api(manager).patch('/business', { businessName: 'Hijack' })).status, 403);

    const ok = await api(owner).patch('/business', {
        businessName: 'SYB Education',
        phone: '+91 484 000 0000',
        address: 'MG Road, Kochi',
        gstin: '32abcde1234f1z5',
        currency: 'INR',
    });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.data.business.businessName, 'SYB Education');
    assert.strictEqual(ok.body.data.business.gstin, '32ABCDE1234F1Z5');
    assert.strictEqual(ok.body.data.business.currency, 'INR');

    assert.strictEqual((await api(owner).patch('/business', { currency: 'XYZ' })).status, 400);
    assert.strictEqual((await api(owner).patch('/business', { email: 'not-an-email' })).status, 400);
    assert.strictEqual((await api(owner).patch('/business', { businessName: ' ' })).status, 400);
});

test('changing password needs the current one and a strong new one', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });

    const wrong = await api(owner).post('/password', { currentPassword: 'nope', newPassword: 'NewPassword456' });
    assert.strictEqual(wrong.status, 400);
    assert.match(wrong.body.message, /current password/i);

    const weak = await api(owner).post('/password', { currentPassword: h.PASSWORD, newPassword: 'short' });
    assert.strictEqual(weak.status, 400);

    const ok = await api(owner).post('/password', { currentPassword: h.PASSWORD, newPassword: 'NewPassword456' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));

    assert.strictEqual((await login(owner.email, h.PASSWORD)).status, 401);
    assert.strictEqual((await login(owner.email, 'NewPassword456')).status, 200);
});

test('a Google-only account can set a first password without a current one', async () => {
    const business = await h.makeBusiness();
    const googleUser = await User.create({
        businessId: business._id,
        name: 'Google Person',
        email: 'gp@example.com',
        googleId: 'g-1',
        role: 'SALESPERSON',
    });

    const profile = await api(googleUser).get('');
    assert.strictEqual(profile.body.data.profile.hasPassword, false);

    const res = await api(googleUser).post('/password', { newPassword: 'FirstPassword789' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual((await login('gp@example.com', 'FirstPassword789')).status, 200);
});
