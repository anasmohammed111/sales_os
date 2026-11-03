const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');

before(h.startDb);
after(h.stopDb);

test('health endpoint reports the API is running', async () => {
    const res = await request(app).get('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
});

test('existing password login still works through the exported app', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });

    const res = await request(app)
        .post('/api/auth/login')
        .send({ email: owner.email, password: h.PASSWORD });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.token);
});
