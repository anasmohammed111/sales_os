const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const h = require('./helpers');
const app = require('../src/app');
const Business = require('../src/models/Business');
const Lead = require('../src/models/Leads');
const Pipeline = require('../src/models/Pipeline');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const api = (user) => ({
    get: (path) => request(app).get(`/api${path}`).set(h.auth(user)),
    post: (path, body = {}) => request(app).post(`/api${path}`).set(h.auth(user)).send(body),
    patch: (path, body = {}) => request(app).patch(`/api${path}`).set(h.auth(user)).send(body),
    delete: (path, body = {}) => request(app).delete(`/api${path}`).set(h.auth(user)).send(body),
});

const company = async ({ admissions = true } = {}) => {
    const business = await h.makeBusiness({ admissions });
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const rep = await h.makeUser(business, { role: 'SALESPERSON' });
    return { business, owner, rep, as: api(owner) };
};

const list = async (as) => {
    const res = await as.get('/pipelines');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    return res.body.data.pipelines;
};

const lead = (business, owner, extra = {}) =>
    Lead.create({ businessId: business._id, customerName: 'Lead', createdBy: owner._id, assignedTo: owner._id, ...extra });

// The stages as the settings screen sends them back
const editable = (pipeline) =>
    pipeline.stages.filter((s) => !s.isArchived).map(({ key, name, color, kind }) => ({ key, name, color, kind }));

test('members read pipelines; only pipeline admins change them', async () => {
    const { rep, as } = await company();

    const seen = await api(rep).get('/pipelines');
    assert.strictEqual(seen.status, 200, JSON.stringify(seen.body));
    assert.strictEqual(seen.body.data.pipelines.length, 1);
    assert.strictEqual(seen.body.data.admissionsEnabled, true);
    assert.ok(seen.body.data.pipelines[0].stages.every((s) => s.leadCount === undefined));

    assert.strictEqual((await api(rep).post('/pipelines', { name: 'Mine', template: 'STANDARD' })).status, 403);
    assert.strictEqual((await as.post('/pipelines', { name: 'Corporate', template: 'STANDARD' })).status, 201);
    assert.ok((await list(as)).every((p) => p.stages.every((s) => typeof s.leadCount === 'number')));
});

test('create from standard, blank and a copy', async () => {
    const { as } = await company({ admissions: false });
    const [main] = await list(as);

    const standard = await as.post('/pipelines', { name: 'Standard', template: 'STANDARD' });
    assert.strictEqual(standard.status, 201, JSON.stringify(standard.body));
    assert.deepStrictEqual(
        standard.body.data.pipeline.stages.map((s) => s.key),
        ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTATION_SENT', 'NEGOTIATION', 'WON', 'LOST']
    );

    const blank = await as.post('/pipelines', { name: 'Blank', template: 'BLANK' });
    assert.deepStrictEqual(
        blank.body.data.pipeline.stages.map((s) => [s.name, s.kind]),
        [
            ['New', 'OPEN'],
            ['Won', 'WON'],
            ['Lost', 'LOST'],
        ]
    );

    // A pipeline that has a hand-off stage, copied while the module is off: the hand-off is dropped
    await Pipeline.updateOne(
        { _id: main.id },
        { $push: { stages: { key: 'ADMISSIONS', name: 'Admissions', color: '#2563EB', kind: 'ADMISSIONS', order: 99 } } }
    );
    const copy = await as.post('/pipelines', { name: 'Copy', template: 'COPY', copyFrom: main.id });
    assert.strictEqual(copy.status, 201, JSON.stringify(copy.body));
    assert.deepStrictEqual(
        copy.body.data.pipeline.stages.map((s) => s.key),
        main.stages.map((s) => s.key)
    );
    assert.strictEqual(copy.body.data.pipeline.linkedToAdmissions, false);

    assert.strictEqual((await as.post('/pipelines', { name: 'copy', template: 'STANDARD' })).status, 409);
    assert.strictEqual((await as.post('/pipelines', { name: '  ', template: 'STANDARD' })).status, 400);
    assert.strictEqual((await as.post('/pipelines', { name: 'Odd', template: 'WEIRD' })).status, 400);
});

test('a new pipeline can be linked to Admissions only when the company has the module', async () => {
    const off = await company({ admissions: false });
    assert.strictEqual((await off.as.post('/pipelines', { name: 'Students', template: 'STANDARD', linkAdmissions: true })).status, 400);

    const on = await company();
    const linked = await on.as.post('/pipelines', { name: 'Students', template: 'STANDARD', linkAdmissions: true });
    assert.strictEqual(linked.status, 201, JSON.stringify(linked.body));
    const keys = linked.body.data.pipeline.stages.map((s) => s.key);
    assert.strictEqual(keys[keys.indexOf('WON') + 1], 'ADMISSIONS');
    assert.strictEqual(linked.body.data.pipeline.linkedToAdmissions, true);
});

test('rename stages without touching leads', async () => {
    const { business, owner, as } = await company();
    const [main] = await list(as);
    const won = await lead(business, owner, { pipelineId: main.id, status: 'WON' });

    const stages = editable(main).map((s) => (s.key === 'WON' ? { ...s, name: 'Enrolled', color: '#123ABC' } : s));
    const res = await as.patch(`/pipelines/${main.id}`, { name: 'Students', stages });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    assert.strictEqual((await Lead.findById(won._id)).status, 'WON');
    const [after] = await list(as);
    assert.strictEqual(after.name, 'Students');
    const renamed = after.stages.find((s) => s.key === 'WON');
    assert.deepStrictEqual([renamed.name, renamed.color, renamed.leadCount], ['Enrolled', '#123ABC', 1]);
});

test('stages can be reordered, added and recoloured', async () => {
    const { as } = await company();
    const [main] = await list(as);
    const stages = editable(main);
    const reordered = [stages[1], stages[0], ...stages.slice(2), { name: 'Site visit', color: '#0891B2', kind: 'OPEN' }];

    const res = await as.patch(`/pipelines/${main.id}`, { stages: reordered });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const active = res.body.data.pipeline.stages.filter((s) => !s.isArchived);
    assert.deepStrictEqual(active.slice(0, 2).map((s) => s.key), ['CONTACTED', 'NEW']);
    assert.deepStrictEqual(active.at(-1), { key: 'SITE_VISIT', name: 'Site visit', color: '#0891B2', kind: 'OPEN', order: active.length - 1, isArchived: false, leadCount: 0 });
});

test('removing a stage with leads needs a destination', async () => {
    const { business, owner, as } = await company();
    const [main] = await list(as);
    const parked = await lead(business, owner, { pipelineId: main.id, status: 'ON_HOLD' });
    const without = editable(main).filter((s) => s.key !== 'ON_HOLD');

    const refused = await as.patch(`/pipelines/${main.id}`, { stages: without });
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.code, 'STAGES_HAVE_LEADS');
    assert.deepStrictEqual(refused.body.stages, [{ key: 'ON_HOLD', name: 'On hold', leadCount: 1 }]);
    assert.ok((await list(as))[0].stages.some((s) => s.key === 'ON_HOLD' && !s.isArchived));

    const intoHandoff = await as.patch(`/pipelines/${main.id}`, { stages: without, moves: { ON_HOLD: 'ADMISSIONS' } });
    assert.strictEqual(intoHandoff.status, 400, JSON.stringify(intoHandoff.body));

    const moved = await as.patch(`/pipelines/${main.id}`, { stages: without, moves: { ON_HOLD: 'NEW' } });
    assert.strictEqual(moved.status, 200, JSON.stringify(moved.body));
    const after = await Lead.findById(parked._id);
    assert.strictEqual(after.status, 'NEW');
    const entry = after.statusHistory.at(-1);
    assert.deepStrictEqual([entry.fromStatus, entry.toStatus, entry.reason, String(entry.pipelineId)], ['ON_HOLD', 'NEW', 'Stage removed', main.id]);
    const kept = (await list(as))[0].stages.find((s) => s.key === 'ON_HOLD');
    assert.strictEqual(kept.isArchived, true);
});

test('two pipelines can share stage keys', async () => {
    const { business, owner, as } = await company();
    const [main] = await list(as);
    const copy = (await as.post('/pipelines', { name: 'Corporate', template: 'COPY', copyFrom: main.id })).body.data.pipeline;
    await lead(business, owner, { pipelineId: main.id, status: 'NEW' });
    await lead(business, owner, { status: 'NEW' }); // no pipelineId: the default pipeline
    await lead(business, owner, { pipelineId: copy.id, status: 'NEW' });

    const counts = Object.fromEntries((await list(as)).map((p) => [p.name, p.stages.find((s) => s.key === 'NEW').leadCount]));
    assert.deepStrictEqual(counts, { 'Sales pipeline': 2, Corporate: 1 });
});

test('linking needs the module; an existing link survives the module going off', async () => {
    const { business, as } = await company({ admissions: false });
    const [main] = await list(as);
    const handoff = { name: 'Ready to apply', color: '#2563EB', kind: 'ADMISSIONS' };

    const refused = await as.patch(`/pipelines/${main.id}`, { stages: [...editable(main), handoff] });
    assert.strictEqual(refused.status, 400, JSON.stringify(refused.body));

    await Business.updateOne({ _id: business._id }, { $set: { 'features.admissions': true } });
    const linked = await as.patch(`/pipelines/${main.id}`, { stages: [...editable(main), handoff] });
    assert.strictEqual(linked.status, 200, JSON.stringify(linked.body));
    assert.strictEqual(linked.body.data.pipeline.linkedToAdmissions, true);

    await Business.updateOne({ _id: business._id }, { $set: { 'features.admissions': false } });
    const [current] = await list(as);
    const renamed = editable(current).map((s) => (s.key === 'NEW' ? { ...s, name: 'Fresh' } : s));
    const kept = await as.patch(`/pipelines/${main.id}`, { stages: renamed });
    assert.strictEqual(kept.status, 200, JSON.stringify(kept.body));
    assert.ok(kept.body.data.pipeline.stages.some((s) => s.kind === 'ADMISSIONS' && !s.isArchived));
});

test('making a stage with leads the hand-off says those leads will not become students', async () => {
    const { business, owner, as } = await company({ admissions: true });
    const [main] = await list(as);
    await lead(business, owner, { pipelineId: main.id, status: 'NEGOTIATION' });
    // Drop today's hand-off stage and make Negotiation the hand-off instead
    const stages = editable(main)
        .filter((s) => s.kind !== 'ADMISSIONS')
        .map((s) => (s.key === 'NEGOTIATION' ? { ...s, kind: 'ADMISSIONS' } : s));

    const res = await as.patch(`/pipelines/${main.id}`, { stages });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.newlyLinkedLeadCount, 1);
});

test('one pipeline is the default', async () => {
    const { business, owner, as } = await company();
    const [main] = await list(as);
    const loose = await lead(business, owner, { status: 'NEW' }); // no pipelineId yet
    const second = (await as.post('/pipelines', { name: 'Corporate', template: 'STANDARD' })).body.data.pipeline;

    const res = await as.patch(`/pipelines/${second.id}`, { isDefault: true });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const flags = Object.fromEntries((await list(as)).map((p) => [p.name, p.isDefault]));
    assert.deepStrictEqual(flags, { 'Sales pipeline': false, Corporate: true });
    // A lead that relied on "no pipeline = the default" stays where it was
    assert.strictEqual(String((await Lead.findById(loose._id)).pipelineId), main.id);
});

test('the default pipeline cannot be deleted; deleting with leads needs a destination', async () => {
    const { business, owner, as } = await company();
    const [main] = await list(as);
    const second = (await as.post('/pipelines', { name: 'Corporate', template: 'STANDARD' })).body.data.pipeline;
    const inSecond = await lead(business, owner, { pipelineId: second.id, status: 'QUALIFIED' });

    const keepDefault = await as.delete(`/pipelines/${main.id}`);
    assert.strictEqual(keepDefault.status, 409);
    assert.strictEqual(keepDefault.body.code, 'DEFAULT_PIPELINE');

    const needsHome = await as.delete(`/pipelines/${second.id}`);
    assert.strictEqual(needsHome.status, 409);
    assert.deepStrictEqual([needsHome.body.code, needsHome.body.leadCount], ['PIPELINE_HAS_LEADS', 1]);

    assert.strictEqual((await as.delete(`/pipelines/${second.id}`, { moveTo: { pipelineId: main.id, stageKey: 'ADMISSIONS' } })).status, 400);

    const removed = await as.delete(`/pipelines/${second.id}`, { moveTo: { pipelineId: main.id, stageKey: 'CONTACTED' } });
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    const moved = await Lead.findById(inSecond._id);
    assert.deepStrictEqual([String(moved.pipelineId), moved.status], [main.id, 'CONTACTED']);
    assert.strictEqual(moved.statusHistory.at(-1).reason, 'Pipeline removed');
    assert.deepStrictEqual((await list(as)).map((p) => p.name), ['Sales pipeline']);
    assert.strictEqual((await Pipeline.findById(second.id)).isArchived, true);
});

test("another company's pipeline is out of reach", async () => {
    const one = await company();
    const two = await company();
    const [theirs] = await list(two.as);

    assert.strictEqual((await one.as.patch(`/pipelines/${theirs.id}`, { name: 'Mine now' })).status, 404);
    assert.strictEqual((await one.as.delete(`/pipelines/${theirs.id}`)).status, 404);
    assert.strictEqual((await one.as.post('/pipelines', { name: 'Copy', template: 'COPY', copyFrom: theirs.id })).status, 404);
});
