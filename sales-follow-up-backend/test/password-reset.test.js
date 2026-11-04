// Capture outgoing mail in memory instead of sending it
process.env.MAIL_TRANSPORT = 'memory';
process.env.APP_URL = 'https://crm.example.com';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const User = require('../src/models/User');
const mailer = require('../src/services/mailer');

before(h.startDb);
after(h.stopDb);
beforeEach(async () => {
    await h.resetDb();
    mailer.outbox.length = 0;
});

const forgot = (email) => request(app).post('/api/auth/forgot-password').send({ email });
const reset = (token, password) => request(app).post('/api/auth/reset-password').send({ token, password });
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

const tokenFromMail = () => {
    const match = /token=([a-f0-9]{64})/.exec(mailer.outbox[0].text);
    assert.ok(match, 'reset link in the email');
    return match[1];
};

test('forgot password emails a one-hour reset link and stores only a hash of the token', async () => {
    const business = await h.makeBusiness();
    const user = await h.makeUser(business, { role: 'OWNER' });

    const res = await forgot(user.email.toUpperCase());

    assert.strictEqual(res.status, 200);
    assert.match(res.body.message, /If an account exists/);
    assert.strictEqual(mailer.outbox.length, 1);
    assert.strictEqual(mailer.outbox[0].to, user.email);
    assert.match(mailer.outbox[0].text, /^https:\/\/crm\.example\.com\/auth\/reset-password\?token=/m);

    const token = tokenFromMail();
    const saved = await User.findById(user._id);
    assert.strictEqual(saved.resetPasswordToken, crypto.createHash('sha256').update(token).digest('hex'));
    const minutes = (saved.resetPasswordExpires - Date.now()) / 60000;
    assert.ok(minutes > 55 && minutes <= 60, `expires in ${minutes} minutes`);
});

test('unknown emails get the same answer and no email', async () => {
    const res = await forgot('nobody@example.com');

    assert.strictEqual(res.status, 200);
    assert.match(res.body.message, /If an account exists/);
    assert.strictEqual(mailer.outbox.length, 0);
});

test('a reset link sets a new password once and cannot be reused', async () => {
    const business = await h.makeBusiness();
    const user = await h.makeUser(business, { role: 'SALESPERSON' });
    await forgot(user.email);
    const token = tokenFromMail();

    assert.strictEqual((await reset(token, 'short')).status, 400);

    const ok = await reset(token, 'BrandNewPass123');
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await login(user.email, 'BrandNewPass123')).status, 200);
    assert.strictEqual((await login(user.email, h.PASSWORD)).status, 401);

    const again = await reset(token, 'AnotherPass456');
    assert.strictEqual(again.status, 400);
    assert.match(again.body.message, /invalid or has expired/);
});

test('expired or made-up tokens are refused', async () => {
    const business = await h.makeBusiness();
    const user = await h.makeUser(business, { role: 'SALESPERSON' });
    await forgot(user.email);
    const token = tokenFromMail();
    await User.updateOne({ _id: user._id }, { $set: { resetPasswordExpires: new Date(Date.now() - 1000) } });

    assert.strictEqual((await reset(token, 'BrandNewPass123')).status, 400);
    assert.strictEqual((await reset('a'.repeat(64), 'BrandNewPass123')).status, 400);
    assert.strictEqual((await reset('', 'BrandNewPass123')).status, 400);
});

test('deactivated accounts get no reset email', async () => {
    const business = await h.makeBusiness();
    const user = await h.makeUser(business, { role: 'SALESPERSON', isActive: false });

    await forgot(user.email);

    assert.strictEqual(mailer.outbox.length, 0);
});
