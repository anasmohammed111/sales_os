const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
const Lead = require('../src/models/Leads');
const Pipeline = require('../src/models/Pipeline');
const pipelines = require('../src/services/pipelines');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

const LEGACY_KEYS = [
    'NEW',
    'CONTACTED',
    'QUALIFIED',
    'QUOTATION_SENT',
    'NEGOTIATION',
    'WON',
    'ADMISSIONS',
    'ON_HOLD',
    'CLOSED',
    'NO_LONGER_REQUIRED',
    'UNRESPONSIVE',
    'LOST',
];

const lead = (business, owner, extra = {}) =>
    Lead.create({ businessId: business._id, customerName: 'Lead', createdBy: owner._id, ...extra });

// A second pipeline with the same stage keys as the default, as a copy would have
const copyOf = (pipeline, name) =>
    Pipeline.create({
        businessId: pipeline.businessId,
        name,
        isDefault: false,
        order: 1,
        stages: pipeline.stages.map((s) => ({ key: s.key, name: s.name, color: s.color, kind: s.kind, order: s.order })),
    });

const stage = (name, kind, extra = {}) => ({ name, kind, color: '#64748B', ...extra });
const target = (t) => t && [String(t.pipelineId), t.status];
const MINIMUM = [stage('New', 'OPEN'), stage('Won', 'WON'), stage('Lost', 'LOST')];

const rejects = (fn, pattern) => {
    try {
        fn();
    } catch (error) {
        assert.strictEqual(error.status, 400, `expected a 400, got ${error.status}: ${error.message}`);
        if (pattern) assert.match(error.message, pattern);
        return;
    }
    assert.fail('expected validateStages to refuse these stages');
};

test('ensureDefaultPipeline creates "Sales pipeline" once with the legacy keys', async () => {
    const business = await h.makeBusiness();

    const first = await pipelines.ensureDefaultPipeline(business._id);
    const again = await pipelines.ensureDefaultPipeline(business._id);

    assert.strictEqual(await Pipeline.countDocuments({ businessId: business._id }), 1);
    assert.strictEqual(String(again._id), String(first._id));
    assert.strictEqual(first.name, 'Sales pipeline');
    assert.strictEqual(first.isDefault, true);
    assert.deepStrictEqual(first.stages.map((s) => s.key), LEGACY_KEYS);
    assert.deepStrictEqual(
        first.stages.filter((s) => s.kind === 'PARKED').map((s) => s.key),
        ['ON_HOLD', 'CLOSED', 'NO_LONGER_REQUIRED', 'UNRESPONSIVE']
    );
});

test('the Admissions stage is only added when the company has the module or Admissions leads', async () => {
    const off = await h.makeBusiness({ admissions: false });
    assert.ok(!(await pipelines.ensureDefaultPipeline(off._id)).stages.some((s) => s.key === 'ADMISSIONS'));

    const offWithStudents = await h.makeBusiness({ admissions: false });
    const owner = await h.makeUser(offWithStudents, { role: 'OWNER' });
    await lead(offWithStudents, owner, { status: 'ADMISSIONS' });
    assert.ok((await pipelines.ensureDefaultPipeline(offWithStudents._id)).stages.some((s) => s.key === 'ADMISSIONS'));

    const on = await h.makeBusiness();
    assert.ok((await pipelines.ensureDefaultPipeline(on._id)).stages.some((s) => s.key === 'ADMISSIONS'));
});

test('kindFilter matches leads without a pipelineId on the default pipeline only', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const main = await pipelines.ensureDefaultPipeline(business._id);
    const other = await copyOf(main, 'Corporate');
    await lead(business, owner, { pipelineId: main._id, status: 'WON' });
    await lead(business, owner, { status: 'WON' });
    await lead(business, owner, { pipelineId: other._id, status: 'WON' });

    assert.strictEqual(await Lead.countDocuments(pipelines.kindFilter([main], ['WON'])), 2);
    assert.strictEqual(await Lead.countDocuments(pipelines.kindFilter([main, other], ['WON'])), 3);
    assert.deepStrictEqual(pipelines.kindFilter([main], ['ADMISSIONS_NOT_A_KIND']), { _id: null });
});

test('stageLookup reads stages, falling back to the default pipeline', async () => {
    const business = await h.makeBusiness();
    const main = await pipelines.ensureDefaultPipeline(business._id);
    const lookup = pipelines.stageLookup([main]);

    assert.strictEqual(lookup.kindOf(null, 'WON'), 'WON');
    assert.strictEqual(lookup.kindOf(main._id, 'ON_HOLD'), 'PARKED');
    assert.strictEqual(lookup.stageOf(String(main._id), 'QUOTATION_SENT').name, 'Quotation sent');
    assert.strictEqual(lookup.kindOf(main._id, 'NOPE'), null);
    assert.strictEqual(String(lookup.defaultId), String(main._id));
});

test('validateStages enforces kinds', () => {
    const ok = { admissionsEnabled: true };
    rejects(() => pipelines.validateStages([stage('New', 'OPEN'), stage('Lost', 'LOST')], ok), /Won/);
    rejects(() => pipelines.validateStages([stage('New', 'OPEN'), stage('Won', 'WON')], ok), /Lost/);
    rejects(() => pipelines.validateStages([stage('Won', 'WON'), stage('Lost', 'LOST')], ok), /open/i);
    rejects(() => pipelines.validateStages([...MINIMUM, stage('A', 'ADMISSIONS'), stage('B', 'ADMISSIONS')], ok), /Admissions/);
    rejects(() => pipelines.validateStages([...MINIMUM, stage('Apply', 'ADMISSIONS')], { admissionsEnabled: false }), /Admissions/);
    rejects(() => pipelines.validateStages([...MINIMUM, stage('Odd', 'OPEN', { color: 'red' })], ok), /colour/i);
    rejects(() => pipelines.validateStages([...MINIMUM, stage('  ', 'OPEN')], ok), /name/i);
    rejects(() => pipelines.validateStages([...MINIMUM, stage('Mystery', 'MAYBE')], ok), /kind/i);

    // A hand-off stage the pipeline already has survives the module being switched off
    const kept = pipelines.validateStages([...MINIMUM, stage('Apply', 'ADMISSIONS', { key: 'ADMISSIONS' })], {
        admissionsEnabled: false,
        existing: [{ key: 'ADMISSIONS', kind: 'ADMISSIONS' }],
    });
    assert.strictEqual(kept.find((s) => s.kind === 'ADMISSIONS').key, 'ADMISSIONS');
    // ...but an existing stage can't become one while the module is off
    rejects(
        () =>
            pipelines.validateStages([...MINIMUM, stage('Apply', 'ADMISSIONS', { key: 'READY' })], {
                admissionsEnabled: false,
                existing: [{ key: 'READY', kind: 'OPEN' }],
            }),
        /Admissions/
    );

    const named = pipelines.validateStages([stage('Call', 'OPEN'), stage('Call', 'OPEN'), stage('Won', 'WON'), stage('Lost', 'LOST')], ok);
    assert.deepStrictEqual(named.map((s) => s.key), ['CALL', 'CALL_2', 'WON', 'LOST']);
    assert.deepStrictEqual(named.map((s) => s.order), [0, 1, 2, 3]);

    // A new stage never takes the key of an archived one
    const fresh = pipelines.validateStages([stage('On hold', 'PARKED'), ...MINIMUM], {
        ...ok,
        existing: [{ key: 'ON_HOLD', kind: 'PARKED', isArchived: true }],
    });
    assert.strictEqual(fresh[0].key, 'ON_HOLD_2');
});

test('admissionsTarget follows the spec order', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const main = await pipelines.ensureDefaultPipeline(business._id);
    const linked = await copyOf(main, 'Students');
    const unlinked = await Pipeline.create({
        businessId: business._id,
        name: 'Corporate',
        order: 2,
        stages: [
            { key: 'NEW', name: 'New', color: '#64748B', kind: 'OPEN', order: 0 },
            { key: 'WON', name: 'Won', color: '#10B981', kind: 'WON', order: 1 },
            { key: 'LOST', name: 'Lost', color: '#EF4444', kind: 'LOST', order: 2 },
        ],
    });

    const inLinked = await lead(business, owner, { pipelineId: linked._id });
    assert.deepStrictEqual(target(await pipelines.admissionsTarget(business._id, inLinked)), [String(linked._id), 'ADMISSIONS']);

    const inUnlinked = await lead(business, owner, { pipelineId: unlinked._id });
    assert.deepStrictEqual(target(await pipelines.admissionsTarget(business._id, inUnlinked)), [String(main._id), 'ADMISSIONS']);

    // No pipeline linked at all: nothing to move to
    await Pipeline.updateMany({ businessId: business._id }, { $pull: { stages: { kind: 'ADMISSIONS' } } });
    assert.strictEqual(await pipelines.admissionsTarget(business._id, inUnlinked), null);
});

test('admissionsTarget falls back to the first linked pipeline when the default is not linked', async () => {
    const business = await h.makeBusiness({ admissions: false });
    const owner = await h.makeUser(business, { role: 'OWNER' });
    const main = await pipelines.ensureDefaultPipeline(business._id);
    const students = await Pipeline.create({
        businessId: business._id,
        name: 'Students',
        order: 1,
        stages: [...main.stages.map((s) => s.toObject()), { key: 'APPLY', name: 'Apply', color: '#2563EB', kind: 'ADMISSIONS', order: 20 }],
    });
    const inMain = await lead(business, owner, { pipelineId: main._id });

    assert.deepStrictEqual(target(await pipelines.admissionsTarget(business._id, inMain)), [String(students._id), 'APPLY']);
});

test('linkAdmissionsOnEnable adds a hand-off stage once', async () => {
    const business = await h.makeBusiness({ admissions: false });
    const main = await pipelines.ensureDefaultPipeline(business._id);
    assert.ok(!main.stages.some((s) => s.kind === 'ADMISSIONS'));

    assert.strictEqual(await pipelines.linkAdmissionsOnEnable(business._id), true);
    const linked = await Pipeline.findById(main._id);
    const keys = linked.stages.map((s) => s.key);
    assert.strictEqual(keys[keys.indexOf('WON') + 1], 'ADMISSIONS');
    assert.strictEqual(linked.stages.find((s) => s.key === 'ADMISSIONS').kind, 'ADMISSIONS');

    assert.strictEqual(await pipelines.linkAdmissionsOnEnable(business._id), false);
    assert.strictEqual((await Pipeline.findById(main._id)).stages.length, linked.stages.length);
});

test('linkAdmissionsOnEnable leaves a company alone when another pipeline is linked', async () => {
    const business = await h.makeBusiness({ admissions: false });
    const main = await pipelines.ensureDefaultPipeline(business._id);
    await Pipeline.create({
        businessId: business._id,
        name: 'Students',
        order: 1,
        stages: [...main.stages.map((s) => s.toObject()), { key: 'APPLY', name: 'Apply', color: '#2563EB', kind: 'ADMISSIONS', order: 20 }],
    });

    assert.strictEqual(await pipelines.linkAdmissionsOnEnable(business._id), false);
    assert.ok(!(await Pipeline.findById(main._id)).stages.some((s) => s.kind === 'ADMISSIONS'));
});

test('a removed hand-off stage key is not reused when linking again', async () => {
    const business = await h.makeBusiness();
    const main = await pipelines.ensureDefaultPipeline(business._id);
    await Pipeline.updateOne({ _id: main._id, 'stages.key': 'ADMISSIONS' }, { $set: { 'stages.$.isArchived': true } });

    assert.strictEqual(await pipelines.linkAdmissionsOnEnable(business._id), true);
    const stages = (await Pipeline.findById(main._id)).stages.filter((s) => s.kind === 'ADMISSIONS');
    assert.deepStrictEqual(
        stages.map((s) => [s.key, s.isArchived]).sort(),
        [
            ['ADMISSIONS', true],
            ['ADMISSIONS_2', false],
        ]
    );
});
