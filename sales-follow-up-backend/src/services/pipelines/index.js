const Business = require('../../models/Business');
const Lead = require('../../models/Leads');
const Pipeline = require('../../models/Pipeline');

const { STAGE_KINDS, STAGE_KEY, HEX_COLOUR } = Pipeline;

const stage = (key, name, color, kind) => ({ key, name, color, kind });

/** What a new company starts with. */
const STANDARD_STAGES = [
    stage('NEW', 'New', '#64748B', 'OPEN'),
    stage('CONTACTED', 'Contacted', '#2563EB', 'OPEN'),
    stage('QUALIFIED', 'Qualified', '#7C3AED', 'OPEN'),
    stage('QUOTATION_SENT', 'Quotation sent', '#F59E0B', 'OPEN'),
    stage('NEGOTIATION', 'Negotiation', '#E5603E', 'OPEN'),
    stage('WON', 'Won', '#10B981', 'WON'),
    stage('LOST', 'Lost', '#EF4444', 'LOST'),
];

/** The board every company had before pipelines were customisable, keys unchanged. */
const LEGACY_STAGES = [
    ...STANDARD_STAGES.slice(0, 6),
    stage('ADMISSIONS', 'Admissions', '#2563EB', 'ADMISSIONS'),
    stage('ON_HOLD', 'On hold', '#D97706', 'PARKED'),
    stage('CLOSED', 'Closed', '#475569', 'PARKED'),
    stage('NO_LONGER_REQUIRED', 'Not required', '#64748B', 'PARKED'),
    stage('UNRESPONSIVE', 'Unresponsive', '#94A3B8', 'PARKED'),
    STANDARD_STAGES[6],
];

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const plain = (s) => (typeof s?.toObject === 'function' ? s.toObject() : { ...s });
const activeStages = (pipeline) => (pipeline?.stages || []).filter((s) => !s.isArchived);
const handoffStage = (pipeline) => activeStages(pipeline).find((s) => s.kind === 'ADMISSIONS') || null;

/**
 * The company's default pipeline, creating "Sales pipeline" the first time.
 * The Admissions stage is only kept for companies that use Admissions.
 */
const ensureDefaultPipeline = async (businessId, { stages = LEGACY_STAGES } = {}) => {
    const existing = await Pipeline.find({ businessId, isArchived: false }).sort({ order: 1, createdAt: 1 });
    if (existing.length) {
        const flagged = existing.find((p) => p.isDefault);
        if (flagged) return flagged;
        existing[0].isDefault = true;
        return existing[0].save();
    }

    let chosen = stages;
    if (stages.some((s) => s.kind === 'ADMISSIONS')) {
        const business = await Business.findById(businessId).select('features').lean();
        const usesAdmissions = business?.features?.admissions === true || (await Lead.exists({ businessId, status: 'ADMISSIONS' }));
        if (!usesAdmissions) chosen = stages.filter((s) => s.kind !== 'ADMISSIONS');
    }

    try {
        return await Pipeline.create({
            businessId,
            name: 'Sales pipeline',
            isDefault: true,
            order: 0,
            stages: chosen.map((s, order) => ({ ...s, order, isArchived: false })),
        });
    } catch (error) {
        // Another request created it first
        if (error.code !== 11000) throw error;
        return Pipeline.findOne({ businessId, isDefault: true, isArchived: false });
    }
};

/** The company's pipelines in display order, making sure the default exists. */
const listPipelines = async (businessId) => {
    await ensureDefaultPipeline(businessId);
    return Pipeline.find({ businessId, isArchived: false }).sort({ order: 1, createdAt: 1 });
};

/** Stage lookups over a list of pipelines; a null pipeline id means the default pipeline. */
const stageLookup = (pipelines) => {
    const byId = new Map(pipelines.map((p) => [String(p._id), p]));
    const fallback = pipelines.find((p) => p.isDefault) || pipelines[0] || null;
    const pipelineFor = (pipelineId) => (pipelineId ? byId.get(String(pipelineId)) : fallback) || null;
    // Archived stages still resolve here, so history keeps its labels
    const stageOf = (pipelineId, key) => pipelineFor(pipelineId)?.stages.find((s) => s.key === key) || null;
    const kindOf = (pipelineId, key) => {
        const found = stageOf(pipelineId, key);
        return found && !found.isArchived ? found.kind : null;
    };
    return { pipelineFor, stageOf, kindOf, defaultId: fallback?._id ?? null };
};

/**
 * Mongo filter for leads whose stage is one of `kinds`. Combine it with other
 * conditions through $and: it is an $or of pipeline + stage-key pairs.
 */
const kindFilter = (pipelines, kinds) => {
    const branches = [];
    for (const pipeline of pipelines) {
        const keys = activeStages(pipeline)
            .filter((s) => kinds.includes(s.kind))
            .map((s) => s.key);
        if (!keys.length) continue;
        branches.push({ pipelineId: pipeline._id, status: { $in: keys } });
        if (pipeline.isDefault) branches.push({ pipelineId: null, status: { $in: keys } });
    }
    return branches.length ? { $or: branches } : { _id: null };
};

const slug = (name) =>
    name
        .normalize('NFKD')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 36) || 'STAGE';

/**
 * Checks a pipeline's stages (in board order) and returns them ready to save.
 * `existing` is the pipeline's current stages, archived ones included: their
 * keys are never handed to a new stage, and an existing hand-off stage may stay
 * even while the Admissions module is off.
 */
const validateStages = (stages, { admissionsEnabled = false, existing = [] } = {}) => {
    if (!Array.isArray(stages) || !stages.length) throw badRequest('A pipeline needs stages');
    if (stages.length > 50) throw badRequest('A pipeline can have at most 50 stages');

    const provided = new Set();
    const cleaned = stages.map((raw) => {
        const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
        if (!name || name.length > 60) throw badRequest('Each stage needs a name of 1 to 60 characters');
        if (!STAGE_KINDS.includes(raw.kind)) throw badRequest(`"${name}" needs a kind: ${STAGE_KINDS.join(', ')}`);
        if (typeof raw.color !== 'string' || !HEX_COLOUR.test(raw.color)) throw badRequest(`"${name}" needs a colour like #2563EB`);
        let key = null;
        if (raw.key !== undefined && raw.key !== null && raw.key !== '') {
            if (typeof raw.key !== 'string' || !STAGE_KEY.test(raw.key)) throw badRequest(`"${name}" has an invalid key`);
            if (provided.has(raw.key)) throw badRequest(`Two stages share the key ${raw.key}`);
            provided.add(raw.key);
            key = raw.key;
        }
        return { key, name, color: raw.color, kind: raw.kind };
    });

    const taken = new Set([...existing.map((s) => s.key), ...provided]);
    for (const s of cleaned) {
        if (s.key) continue;
        const base = slug(s.name);
        let key = base;
        for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
        taken.add(key);
        s.key = key;
    }

    const count = (kind) => cleaned.filter((s) => s.kind === kind).length;
    if (!count('OPEN')) throw badRequest('A pipeline needs at least one open stage');
    if (!count('WON')) throw badRequest('A pipeline needs at least one Won stage');
    if (!count('LOST')) throw badRequest('A pipeline needs at least one Lost stage');
    const handoff = cleaned.filter((s) => s.kind === 'ADMISSIONS');
    if (handoff.length > 1) throw badRequest('Only one stage can hand leads over to Admissions');
    if (handoff.length && !admissionsEnabled) {
        const before = existing.find((s) => s.key === handoff[0].key);
        if (!before || before.kind !== 'ADMISSIONS') throw badRequest('Linking a pipeline to Admissions needs the Admissions module');
    }

    return cleaned.map((s, order) => ({ ...s, order, isArchived: false }));
};

/**
 * Where a lead goes when it becomes an Admissions student: its own pipeline's
 * hand-off stage, else the default pipeline's, else the first linked pipeline's.
 */
const admissionsTarget = async (businessId, lead) => {
    const pipelines = await listPipelines(businessId);
    const own = stageLookup(pipelines).pipelineFor(lead?.pipelineId ?? null);
    const fallback = pipelines.find((p) => p.isDefault);
    for (const pipeline of [own, fallback, ...pipelines]) {
        const target = pipeline && handoffStage(pipeline);
        if (target) return { pipelineId: pipeline._id, status: target.key };
    }
    return null;
};

/**
 * When a company gets the Admissions module and no pipeline hands over to it,
 * the default pipeline gains an "Admissions" stage right after its Won stage.
 */
const linkAdmissionsOnEnable = async (businessId) => {
    const pipelines = await listPipelines(businessId);
    if (pipelines.some((p) => handoffStage(p))) return false;

    const target = pipelines.find((p) => p.isDefault) || pipelines[0];
    const keys = new Set(target.stages.map((s) => s.key));
    let key = 'ADMISSIONS';
    for (let n = 2; keys.has(key); n++) key = `ADMISSIONS_${n}`;

    const stages = [...target.stages].sort((a, b) => a.order - b.order).map(plain);
    const won = stages.findIndex((s) => s.kind === 'WON' && !s.isArchived);
    stages.splice(won >= 0 ? won + 1 : stages.length, 0, { key, name: 'Admissions', color: '#2563EB', kind: 'ADMISSIONS', isArchived: false });
    target.stages = stages.map((s, order) => ({ ...s, order }));
    await target.save();
    return true;
};

module.exports = {
    STAGE_KINDS,
    STANDARD_STAGES,
    LEGACY_STAGES,
    activeStages,
    ensureDefaultPipeline,
    listPipelines,
    stageLookup,
    kindFilter,
    validateStages,
    admissionsTarget,
    linkAdmissionsOnEnable,
};
