// Small upload limit so the size check is cheap to exercise
process.env.UPLOAD_MAX_MB = '1';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const AdmissionDocument = require('../src/models/AdmissionDocument');
const Reminder = require('../src/models/Reminder');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('fake passport scan body')]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);

const api = (user) => ({
    get: (path) => request(app).get(`/api/admissions${path}`).set(h.auth(user)),
    post: (path, body) => request(app).post(`/api/admissions${path}`).set(h.auth(user)).send(body),
    patch: (path, body) => request(app).patch(`/api/admissions${path}`).set(h.auth(user)).send(body),
    upload: (path, buffer, filename) =>
        request(app).post(`/api/admissions${path}`).set(h.auth(user)).attach('file', buffer, filename),
});

const setup = async () => {
    const team = await h.makeAdmissionsTeam();
    const created = await api(team.owner).post('/applications', h.studentPayload({ counsellorId: team.counsellorA._id.toString() }));
    const applicationId = created.body.data.id;
    const doc = await api(team.counsellorA).post(`/applications/${applicationId}/documents`, { documentTypeKey: 'passport' });
    assert.strictEqual(doc.status, 201, JSON.stringify(doc.body));
    return { ...team, applicationId, documentId: doc.body.data.id };
};

test('a checklist-only document record starts as missing and lists with the configured types', async () => {
    const { counsellorA, applicationId } = await setup();

    const res = await api(counsellorA).get(`/applications/${applicationId}/documents`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.types.some((t) => t.key === 'passport'));
    assert.strictEqual(res.body.data.documents.length, 1);
    assert.strictEqual(res.body.data.documents[0].status, 'MISSING');
    assert.strictEqual(res.body.data.documents[0].file.hasFile, false);
});

test('unknown document types are rejected', async () => {
    const { counsellorA, applicationId } = await setup();
    const res = await api(counsellorA).post(`/applications/${applicationId}/documents`, { documentTypeKey: 'selfie' });
    assert.strictEqual(res.status, 400);
});

test('uploading marks a document uploaded, never verified, and hides the storage key', async () => {
    const { counsellorA, documentId } = await setup();

    const res = await api(counsellorA).upload(`/documents/${documentId}/file`, PDF, 'passport.pdf');

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.status, 'UPLOADED');
    assert.strictEqual(res.body.data.file.originalName, 'passport.pdf');
    assert.strictEqual(res.body.data.file.hasFile, true);
    assert.strictEqual(res.body.data.uploadedBy.name, 'Counsellor A');
    assert.strictEqual(JSON.stringify(res.body).includes('storageKey'), false);

    const stored = await AdmissionDocument.findById(documentId);
    assert.match(stored.file.storageKey, /^[a-f0-9]{24}\/[a-f0-9]{24}\/[a-f0-9-]{36}\.pdf$/);
});

test('files that are not really PDF or images are rejected', async () => {
    const { counsellorA, documentId } = await setup();

    const res = await api(counsellorA).upload(`/documents/${documentId}/file`, EXE, 'passport.pdf');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /PDF, JPG, PNG or WEBP/);
});

test('files over the size limit are rejected', async () => {
    const { counsellorA, documentId } = await setup();
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1.5 * 1024 * 1024, 7)]);

    const res = await api(counsellorA).upload(`/documents/${documentId}/file`, big, 'big.pdf');

    assert.strictEqual(res.status, 413);
});

test('rejecting needs a reason; verifying records the reviewer; re-uploading needs a new review', async () => {
    const { counsellorA, documentId } = await setup();
    await api(counsellorA).upload(`/documents/${documentId}/file`, PDF, 'passport.pdf');

    const noReason = await api(counsellorA).patch(`/documents/${documentId}/review`, { status: 'REJECTED' });
    assert.strictEqual(noReason.status, 400);

    const rejected = await api(counsellorA).patch(`/documents/${documentId}/review`, { status: 'REJECTED', reason: 'Scan is blurry' });
    assert.strictEqual(rejected.body.data.status, 'REJECTED');
    assert.strictEqual(rejected.body.data.rejectionReason, 'Scan is blurry');

    await api(counsellorA).upload(`/documents/${documentId}/file`, PDF, 'passport-2.pdf');
    const verified = await api(counsellorA).patch(`/documents/${documentId}/review`, { status: 'VERIFIED' });
    assert.strictEqual(verified.body.data.status, 'VERIFIED');
    assert.strictEqual(verified.body.data.reviewedBy.name, 'Counsellor A');
    assert.ok(verified.body.data.reviewedAt);
    assert.strictEqual(verified.body.data.rejectionReason, '');

    const reupload = await api(counsellorA).upload(`/documents/${documentId}/file`, PDF, 'passport-3.pdf');
    assert.strictEqual(reupload.body.data.status, 'UPLOADED');
    assert.strictEqual(reupload.body.data.reviewedBy, null);
});

test('other staff cannot list, upload, review or download the documents', async () => {
    const { counsellorA, counsellorB, applicationId, documentId } = await setup();
    await api(counsellorA).upload(`/documents/${documentId}/file`, PDF, 'passport.pdf');

    assert.strictEqual((await api(counsellorB).get(`/applications/${applicationId}/documents`)).status, 404);
    assert.strictEqual((await api(counsellorB).upload(`/documents/${documentId}/file`, PDF, 'x.pdf')).status, 404);
    assert.strictEqual((await api(counsellorB).patch(`/documents/${documentId}/review`, { status: 'VERIFIED' })).status, 404);
    assert.strictEqual((await api(counsellorB).get(`/documents/${documentId}/download-url`)).status, 404);
});

test('downloads use a short-lived signed link that cannot be forged or reused later', async () => {
    const { owner, counsellorA, documentId } = await setup();
    await api(counsellorA).upload(`/documents/${documentId}/file`, PDF, 'passport.pdf');

    const link = await api(owner).get(`/documents/${documentId}/download-url`);
    assert.strictEqual(link.status, 200);
    assert.strictEqual(link.body.data.expiresInSeconds, 60);
    assert.match(link.body.data.url, /^\/api\/admissions\/files\//);

    // The link works without an Authorization header (it opens in a new tab)
    const file = await request(app).get(link.body.data.url).buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.strictEqual(file.status, 200);
    assert.strictEqual(file.headers['content-type'], 'application/pdf');
    assert.strictEqual(file.headers['cache-control'], 'private, no-store');
    assert.ok(Buffer.compare(file.body, PDF) === 0);

    const token = link.body.data.url.split('/').pop();
    assert.strictEqual((await request(app).get(`/api/admissions/files/${token}x`)).status, 401);

    const expired = jwt.sign({ docId: documentId, kind: 'document' }, process.env.JWT_SECRET, {
        expiresIn: -10,
        audience: 'admissions-file',
    });
    assert.strictEqual((await request(app).get(`/api/admissions/files/${expired}`)).status, 401);

    // A plain session JWT is not a file token
    const sessionToken = h.auth(owner).Authorization.split(' ')[1];
    assert.strictEqual((await request(app).get(`/api/admissions/files/${sessionToken}`)).status, 401);
});

test('a document with an expiry date schedules an expiry reminder', async () => {
    const { counsellorA, documentId } = await setup();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const res = await api(counsellorA).patch(`/documents/${documentId}`, { expiresAt: expiresAt.toISOString() });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const reminder = await Reminder.findOne({ kind: 'DOCUMENT_EXPIRY' });
    assert.ok(reminder);
    assert.strictEqual(reminder.remindAt.getTime(), expiresAt.getTime() - 30 * 24 * 60 * 60 * 1000);
});

test('files named in non-Latin scripts download with an encoded filename', async () => {
    const { counsellorA, documentId } = await setup();
    await api(counsellorA).upload(`/documents/${documentId}/file`, PDF, 'പാസ്പോർട്ട് scan.pdf');

    const link = await api(counsellorA).get(`/documents/${documentId}/download-url`);
    const file = await request(app).get(link.body.data.url);

    assert.strictEqual(file.status, 200);
    const disposition = file.headers['content-disposition'];
    assert.match(disposition, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    assert.ok(disposition.includes(encodeURIComponent('പാസ്പോർട്ട്')));
});
