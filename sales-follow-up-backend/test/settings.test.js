const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const AdmissionApplication = require('../src/models/AdmissionApplication');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const DAY = 24 * 60 * 60 * 1000;

const api = (user) => ({
    get: (path, query = {}) => request(app).get(`/api/admissions${path}`).query(query).set(h.auth(user)),
    post: (path, body) => request(app).post(`/api/admissions${path}`).set(h.auth(user)).send(body),
    put: (path, body) => request(app).put(`/api/admissions${path}`).set(h.auth(user)).send(body),
    patch: (path, body) => request(app).patch(`/api/admissions${path}`).set(h.auth(user)).send(body),
});

const getSettings = async (owner) => {
    const res = await api(owner).get('/settings');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    return res.body.data;
};

const stage = (settings, key) => settings.stages.find((s) => s.key === key);

test('only the admin can change settings', async () => {
    const { owner, manager, counsellorA } = await h.makeAdmissionsTeam();
    const settings = await getSettings(owner);

    assert.strictEqual((await api(counsellorA).put('/settings', settings)).status, 403);
    assert.strictEqual((await api(manager).put('/settings', settings)).status, 403);
    assert.strictEqual((await api(counsellorA).get('/settings')).status, 403);
    assert.strictEqual((await api(owner).put('/settings', settings)).status, 200);
});

test('configuration in use must be archived, not removed', async () => {
    const { owner } = await h.makeAdmissionsTeam();

    const noStage = await getSettings(owner);
    noStage.stages = noStage.stages.filter((s) => s.key !== 'apostille');
    const r1 = await api(owner).put('/settings', noStage);
    assert.strictEqual(r1.status, 400);
    assert.match(r1.body.message, /Apostille.*archive it instead/);

    const noItem = await getSettings(owner);
    stage(noItem, 'apostille').items.pop();
    assert.strictEqual((await api(owner).put('/settings', noItem)).status, 400);

    const noDocType = await getSettings(owner);
    noDocType.documentTypes = noDocType.documentTypes.filter((d) => d.key !== 'pcc');
    assert.strictEqual((await api(owner).put('/settings', noDocType)).status, 400);

    const archived = await getSettings(owner);
    stage(archived, 'apostille').isArchived = true;
    assert.strictEqual((await api(owner).put('/settings', archived)).status, 200);
});

test('stages can be renamed and reordered', async () => {
    const { owner } = await h.makeAdmissionsTeam();
    const settings = await getSettings(owner);

    const [first, second, ...rest] = settings.stages;
    first.name = 'Enquiry & counselling';
    settings.stages = [second, first, ...rest];

    const res = await api(owner).put('/settings', settings);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const saved = await getSettings(owner);
    assert.deepStrictEqual(saved.stages.slice(0, 2).map((s) => [s.key, s.order, s.name]), [
        ['university_selection', 1, 'University Selection'],
        ['lead_counselling', 2, 'Enquiry & counselling'],
    ]);
});

test('a new checklist item reaches existing students who have not passed that stage', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const created = await api(owner).post('/applications', h.studentPayload({ counsellorId: counsellorA._id.toString() }));
    const id = created.body.data.id;

    const settings = await getSettings(owner);
    stage(settings, 'apostille').items.push({ label: 'Translation ordered', required: true });
    const res = await api(owner).put('/settings', settings);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const newItem = stage(res.body.data, 'apostille').items.at(-1);
    assert.strictEqual(newItem.key, 'translation_ordered');

    const profile = await api(counsellorA).get(`/applications/${id}`);
    assert.ok(profile.body.data.checklist.some((e) => e.itemKey === 'translation_ordered' && e.status === 'PENDING'));
});

test('item keys must be unique across the pipeline', async () => {
    const { owner } = await h.makeAdmissionsTeam();
    const settings = await getSettings(owner);
    stage(settings, 'visa').items.push({ key: 'enquiry_received', label: 'Duplicate', required: true });

    const res = await api(owner).put('/settings', settings);
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /enquiry_received/);
});

test('changing a stage threshold changes who is stuck', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const created = await api(owner).post('/applications', h.studentPayload({ counsellorId: counsellorA._id.toString() }));
    await AdmissionApplication.updateOne({ _id: created.body.data.id }, { $set: { stageEnteredAt: new Date(Date.now() - 5 * DAY) } });

    assert.strictEqual((await api(owner).get('/applications', { stuck: '1' })).body.data.total, 0);

    const settings = await getSettings(owner);
    stage(settings, 'lead_counselling').stuckThresholdDays = 3;
    await api(owner).put('/settings', settings);

    assert.strictEqual((await api(owner).get('/applications', { stuck: '1' })).body.data.total, 1);
});

test('students in an archived stage stay visible and can be moved out, but not into it', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();
    const created = await api(owner).post('/applications', h.studentPayload({ counsellorId: counsellorA._id.toString() }));
    const id = created.body.data.id;
    await api(owner).post(`/applications/${id}/stage`, {
        fromStageKey: 'lead_counselling',
        toStageKey: 'apostille',
        override: true,
        reason: 'Test setup jump',
    });

    const settings = await getSettings(owner);
    stage(settings, 'apostille').isArchived = true;
    await api(owner).put('/settings', settings);

    const list = await api(counsellorA).get('/applications');
    assert.strictEqual(list.body.data.total, 1);
    assert.strictEqual(list.body.data.items[0].currentStage.isArchived, true);

    const dashboard = await api(owner).get('/dashboard');
    assert.strictEqual(dashboard.body.data.stages.find((s) => s.key === 'apostille').count, 1);

    const out = await api(counsellorA).post(`/applications/${id}/stage`, {
        fromStageKey: 'apostille',
        toStageKey: 'university_application',
    });
    assert.strictEqual(out.status, 200, JSON.stringify(out.body));

    const back = await api(counsellorA).post(`/applications/${id}/stage`, {
        fromStageKey: 'university_application',
        toStageKey: 'apostille',
    });
    assert.strictEqual(back.status, 400);
});

test('timezone and reminder defaults are validated', async () => {
    const { owner } = await h.makeAdmissionsTeam();

    const bad = await getSettings(owner);
    bad.timezone = 'Mars/Olympus';
    assert.strictEqual((await api(owner).put('/settings', bad)).status, 400);

    const badReminder = await getSettings(owner);
    badReminder.reminderDefaults.examDaysBefore = -1;
    assert.strictEqual((await api(owner).put('/settings', badReminder)).status, 400);

    const good = await getSettings(owner);
    good.timezone = 'Europe/Prague';
    good.reminderDefaults.examDaysBefore = 5;
    const saved = await api(owner).put('/settings', good);
    assert.strictEqual(saved.status, 200);
    assert.strictEqual(saved.body.data.timezone, 'Europe/Prague');
    assert.strictEqual(saved.body.data.reminderDefaults.examDaysBefore, 5);
});

test('new lead sources can be used; archived ones cannot be chosen for new students', async () => {
    const { owner } = await h.makeAdmissionsTeam();
    const settings = await getSettings(owner);
    settings.leadSources.push({ name: 'Education fair' });
    settings.leadSources.find((s) => s.key === 'facebook').isArchived = true;
    const res = await api(owner).put('/settings', settings);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const fair = await api(owner).post('/applications', h.studentPayload({ leadSource: 'education_fair' }));
    assert.strictEqual(fair.status, 201, JSON.stringify(fair.body));

    const facebook = await api(owner).post(
        '/applications',
        h.studentPayload({ leadSource: 'facebook', student: { email: 'fb@example.com', phone: '+91 93333 44444' } })
    );
    assert.strictEqual(facebook.status, 400);
});

test('universities and courses are master data that is archived, not removed', async () => {
    const { owner, counsellorA } = await h.makeAdmissionsTeam();

    assert.strictEqual((await api(counsellorA).post('/universities', { name: 'CTU Prague' })).status, 403);

    const created = await api(owner).post('/universities', {
        name: 'Czech Technical University',
        city: 'Prague',
        courses: [
            { name: 'BSc Software Engineering', level: 'BACHELOR' },
            { name: 'MSc Cybersecurity', level: 'MASTER' },
        ],
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const university = created.body.data;

    const context = await api(counsellorA).get('/context');
    assert.strictEqual(context.body.data.universities.length, 1);

    const withoutCourse = { ...university, courses: university.courses.slice(0, 1) };
    assert.strictEqual((await api(owner).patch(`/universities/${university._id}`, withoutCourse)).status, 400);

    const archivedCourse = {
        ...university,
        courses: university.courses.map((c, i) => (i === 1 ? { ...c, isArchived: true } : c)),
    };
    const updated = await api(owner).patch(`/universities/${university._id}`, archivedCourse);
    assert.strictEqual(updated.status, 200, JSON.stringify(updated.body));
    assert.strictEqual(updated.body.data.courses[1].isArchived, true);

    // Picking from master data fills in the names
    const studentRes = await api(owner).post('/applications', h.studentPayload({ counsellorId: counsellorA._id.toString() }));
    const profile = await api(counsellorA).patch(`/applications/${studentRes.body.data.id}`, {
        finalChoice: { universityId: university._id, courseId: university.courses[0]._id },
    });
    assert.strictEqual(profile.body.data.finalChoice.universityName, 'Czech Technical University');
    assert.strictEqual(profile.body.data.finalChoice.courseName, 'BSc Software Engineering');

    const filtered = await api(owner).get('/applications', { universityId: university._id });
    assert.strictEqual(filtered.body.data.total, 1);
});
