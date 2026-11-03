const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const ExcelJS = require('exceljs');
const h = require('./helpers');
const app = require('../src/app');
const AdmissionApplication = require('../src/models/AdmissionApplication');
const { safeCell, toCsv } = require('../src/services/admissions/exporter');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const DAY = 24 * 60 * 60 * 1000;

const api = (user) => ({
    get: (path, query = {}) => request(app).get(`/api/admissions${path}`).query(query).set(h.auth(user)),
    post: (path, body) => request(app).post(`/api/admissions${path}`).set(h.auth(user)).send(body),
});

const binary = (req) =>
    req.buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

const student = (owner, counsellor, name, phone, extra = {}) =>
    api(owner).post(
        '/applications',
        h.studentPayload({
            student: { name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone },
            counsellorId: counsellor._id.toString(),
            ...extra,
        })
    );

/** A: one stuck student, one with an overdue follow-up. B: one approved visa. */
const setup = async () => {
    const team = await h.makeAdmissionsTeam();
    const { owner, counsellorA, counsellorB } = team;

    const stuck = (await student(owner, counsellorA, 'Asha Nair', '+91 90000 00001')).body.data;
    const overdue = (await student(owner, counsellorA, 'Ravi Kumar', '+91 90000 00002', { studyLevel: 'BACHELOR' })).body.data;
    const approved = (await student(owner, counsellorB, 'Meera Das', '+91 90000 00003')).body.data;

    await AdmissionApplication.updateOne({ _id: stuck.id }, { $set: { stageEnteredAt: new Date(Date.now() - 10 * DAY) } });
    await api(counsellorA).post(`/applications/${overdue.id}/tasks`, {
        type: 'CALL',
        scheduledAt: new Date(Date.now() - DAY).toISOString(),
    });
    await AdmissionApplication.updateOne(
        { _id: approved.id },
        { $set: { status: 'CLOSED', 'visa.outcome': 'APPROVED', 'visa.outcomeAt': new Date() } }
    );

    await api(counsellorA).post(`/applications/${stuck.id}/fees`, { category: 'AGENCY_FEE', amountDue: '50000', currency: 'INR' });
    await api(owner).post(`/applications/${approved.id}/fees`, { category: 'UNIVERSITY_FEE', amountDue: '3000', currency: 'EUR' });

    return { ...team, ids: { stuck: stuck.id, overdue: overdue.id, approved: approved.id } };
};

test("a counsellor's dashboard counts only their own students", async () => {
    const { counsellorA } = await setup();

    const res = await api(counsellorA).get('/dashboard');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;

    assert.strictEqual(d.metrics.newLeads.value, 2);
    assert.strictEqual(d.metrics.active.value, 2);
    assert.strictEqual(d.metrics.stuck.value, 1);
    assert.strictEqual(d.metrics.overdueFollowUps.value, 1);
    assert.strictEqual(d.metrics.visasApproved.value, 0);
    assert.deepStrictEqual(d.outstandingByCurrency.map((r) => [r.currency, r.outstanding]), [['INR', '50000.00']]);
    assert.strictEqual(d.stages.find((s) => s.key === 'lead_counselling').count, 2);
});

test('the admin dashboard covers everyone and defines conversion', async () => {
    const { owner } = await setup();

    const d = (await api(owner).get('/dashboard')).body.data;

    assert.strictEqual(d.metrics.newLeads.value, 3);
    assert.strictEqual(d.metrics.active.value, 2);
    assert.strictEqual(d.metrics.visasApproved.value, 1);
    assert.strictEqual(d.metrics.visasRejected.value, 0);
    assert.strictEqual(d.conversion.cohort, 3);
    assert.strictEqual(d.conversion.approved, 1);
    assert.strictEqual(d.conversion.rate, 1 / 3);
    assert.match(d.conversion.definition, /Of the 3 students added between .+ and .+, 1 has an approved visa/);
    assert.deepStrictEqual(
        d.outstandingByCurrency.map((r) => r.currency),
        ['EUR', 'INR']
    );
});

test('every dashboard card links to a list with exactly the same count', async () => {
    const { owner, counsellorA } = await setup();

    for (const user of [owner, counsellorA]) {
        const d = (await api(user).get('/dashboard')).body.data;
        for (const [name, metric] of Object.entries(d.metrics)) {
            const list = await api(user).get('/applications', metric.query);
            assert.strictEqual(list.body.data.total, metric.value, `${user.name} → ${name}`);
        }
    }
});

test('dashboard filters narrow every figure', async () => {
    const { owner, counsellorB } = await setup();

    const bachelors = (await api(owner).get('/dashboard', { studyLevel: 'BACHELOR' })).body.data;
    assert.strictEqual(bachelors.metrics.newLeads.value, 1);

    const forB = (await api(owner).get('/dashboard', { counsellorId: counsellorB._id.toString() })).body.data;
    assert.strictEqual(forB.metrics.active.value, 0);
    assert.strictEqual(forB.metrics.visasApproved.value, 1);
});

test('CSV export respects filters and permissions', async () => {
    const { counsellorA, counsellorB } = await setup();

    const all = await binary(api(counsellorA).get('/applications/export', { format: 'csv' }));
    assert.strictEqual(all.status, 200);
    assert.match(all.headers['content-disposition'], /attachment; filename="admissions-students-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = all.body.toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.strictEqual(lines.length, 3);
    assert.ok(!all.body.toString('utf8').includes('Meera'));

    const stuckOnly = await binary(api(counsellorA).get('/applications/export', { format: 'csv', stuck: '1' }));
    assert.strictEqual(stuckOnly.body.toString('utf8').trim().split(/\r?\n/).length, 2);

    const asB = await binary(api(counsellorB).get('/applications/export', { format: 'csv', status: 'ALL' }));
    assert.ok(asB.body.toString('utf8').includes('Meera'));
    assert.ok(!asB.body.toString('utf8').includes('Asha'));
});

test('exports neutralise spreadsheet formulas in CSV and Excel', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    await student(owner, counsellorA, '=HYPERLINK("http://evil.example","Click")', '+91 95555 55555');

    const csv = await binary(api(owner).get('/applications/export', { format: 'csv' }));
    assert.ok(csv.body.toString('utf8').includes(`"'=HYPERLINK(""http://evil.example"",""Click"")"`));

    const xlsx = await binary(api(owner).get('/applications/export', { format: 'xlsx' }));
    assert.strictEqual(xlsx.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body);
    const cell = workbook.worksheets[0].getRow(2).getCell(1).value;
    assert.strictEqual(typeof cell, 'string');
    assert.ok(cell.startsWith("'="), `cell was ${cell}`);
});

test('payment export is scoped and lists fee rows', async () => {
    const { owner, counsellorA } = await setup();

    const asOwner = await binary(api(owner).get('/payments/export', { format: 'csv' }));
    assert.strictEqual(asOwner.body.toString('utf8').trim().split(/\r?\n/).length, 3);

    const asA = await binary(api(counsellorA).get('/payments/export', { format: 'csv' }));
    const text = asA.body.toString('utf8');
    assert.strictEqual(text.trim().split(/\r?\n/).length, 2);
    assert.ok(text.includes('INR'));
    assert.ok(!text.includes('EUR'));
});

test('safeCell and toCsv escape dangerous and special values', () => {
    for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
        assert.strictEqual(safeCell(value), `'${value}`);
    }
    assert.strictEqual(safeCell('Asha'), 'Asha');
    assert.strictEqual(safeCell(42), 42);
    assert.strictEqual(safeCell(null), '');

    const csv = toCsv([{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }], [{ a: 'x, y', b: 'say "hi"' }]);
    assert.strictEqual(csv, '﻿A,B\r\n"x, y","say ""hi"""\r\n');
});

test('month boundaries follow the configured timezone, including daylight saving', () => {
    const { zonedMonthRange } = require('../src/services/admissions/time');

    const [indiaStart, indiaEnd] = zonedMonthRange(2027, 3, 'Asia/Kolkata');
    assert.strictEqual(indiaStart.toISOString(), '2027-02-28T18:30:00.000Z');
    assert.strictEqual(indiaEnd.toISOString(), '2027-03-31T18:29:59.999Z');

    // Prague switches from CET (+1) to CEST (+2) on 28 March 2027
    const [pragueStart, pragueEnd] = zonedMonthRange(2027, 3, 'Europe/Prague');
    assert.strictEqual(pragueStart.toISOString(), '2027-02-28T23:00:00.000Z');
    assert.strictEqual(pragueEnd.toISOString(), '2027-03-31T21:59:59.999Z');

    const [decStart, decEnd] = zonedMonthRange(2027, 12, 'Asia/Kolkata');
    assert.strictEqual(decStart.toISOString(), '2027-11-30T18:30:00.000Z');
    assert.strictEqual(decEnd.toISOString(), '2027-12-31T18:29:59.999Z');
});
