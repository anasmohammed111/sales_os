const mongoose = require('mongoose');
const Business = require('../models/Business');
const Lead = require('../models/Leads');
const Pipeline = require('../models/Pipeline');
const { can } = require('../services/access');
const { STANDARD_STAGES, activeStages, listPipelines, validateStages } = require('../services/pipelines');

const BLANK_STAGES = [
    { key: 'NEW', name: 'New', color: '#64748B', kind: 'OPEN' },
    { key: 'WON', name: 'Won', color: '#10B981', kind: 'WON' },
    { key: 'LOST', name: 'Lost', color: '#EF4444', kind: 'LOST' },
];
const HANDOFF = { key: 'ADMISSIONS', name: 'Admissions', color: '#2563EB', kind: 'ADMISSIONS' };
const NOT_A_HANDOFF = 'Use "Move to Admissions" to hand a lead over';

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const plain = (s) => (typeof s?.toObject === 'function' ? s.toObject() : { ...s });
const byOrder = (a, b) => a.order - b.order;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanName = (value) => {
    const name = typeof value === 'string' ? value.trim() : '';
    return name && name.length <= 60 ? name : null;
};

const admissionsOn = async (businessId) =>
    (await Business.findById(businessId).select('features').lean())?.features?.admissions === true;

const nameTaken = (businessId, name, exceptId = null) =>
    Pipeline.exists({
        businessId,
        isArchived: false,
        ...(exceptId ? { _id: { $ne: exceptId } } : {}),
        name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    });

const findOwn = (req, id) =>
    mongoose.isValidObjectId(id) ? Pipeline.findOne({ _id: id, businessId: req.user.businessId, isArchived: false }) : null;

// Leads with no pipelineId belong to the default pipeline
const inPipeline = (pipeline) =>
    pipeline.isDefault ? { $or: [{ pipelineId: pipeline._id }, { pipelineId: null }] } : { pipelineId: pipeline._id };

/** Live (not archived) leads per pipeline and stage, keyed "pipelineId:stageKey". */
const stageCounts = async (businessId, pipelines) => {
    const fallback = pipelines.find((p) => p.isDefault);
    const rows = await Lead.aggregate([
        { $match: { businessId: new mongoose.Types.ObjectId(String(businessId)), isArchived: { $ne: true } } },
        { $group: { _id: { pipelineId: '$pipelineId', status: '$status' }, n: { $sum: 1 } } },
    ]);
    const counts = new Map();
    for (const row of rows) {
        const pipelineId = row._id.pipelineId ?? fallback?._id;
        const key = `${pipelineId}:${row._id.status}`;
        counts.set(key, (counts.get(key) || 0) + row.n);
    }
    return counts;
};

const view = (pipeline, counts = null) => ({
    id: String(pipeline._id),
    name: pipeline.name,
    isDefault: pipeline.isDefault,
    order: pipeline.order,
    linkedToAdmissions: activeStages(pipeline).some((s) => s.kind === 'ADMISSIONS'),
    stages: [...pipeline.stages].sort(byOrder).map((s) => ({
        key: s.key,
        name: s.name,
        color: s.color,
        kind: s.kind,
        order: s.order,
        isArchived: Boolean(s.isArchived),
        ...(counts ? { leadCount: counts.get(`${pipeline._id}:${s.key}`) || 0 } : {}),
    })),
});

const stageError = (res, error, next) => (error.status ? fail(res, error.status, error.message) : next(error));

/** GET /api/pipelines — the company's pipelines; stage lead counts for people who set them up. */
const getPipelines = async (req, res, next) => {
    try {
        const pipelines = await listPipelines(req.user.businessId);
        const counts = can(req, 'settings.pipelines') ? await stageCounts(req.user.businessId, pipelines) : null;
        return res.json({
            success: true,
            data: { pipelines: pipelines.map((p) => view(p, counts)), admissionsEnabled: await admissionsOn(req.user.businessId) },
        });
    } catch (error) {
        next(error);
    }
};

/** POST /api/pipelines — { name, template: STANDARD|BLANK|COPY, copyFrom?, linkAdmissions? } */
const createPipeline = async (req, res, next) => {
    try {
        const body = req.body || {};
        const businessId = req.user.businessId;
        const name = cleanName(body.name);
        if (!name) return fail(res, 400, 'Give the pipeline a name of 1 to 60 characters');

        const pipelines = await listPipelines(businessId);
        if (await nameTaken(businessId, name)) return fail(res, 409, 'A pipeline with that name already exists');
        const enabled = await admissionsOn(businessId);

        let stages;
        if (body.template === 'STANDARD') stages = STANDARD_STAGES.map((s) => ({ ...s }));
        else if (body.template === 'BLANK') stages = BLANK_STAGES.map((s) => ({ ...s }));
        else if (body.template === 'COPY') {
            const source = await findOwn(req, body.copyFrom);
            if (!source) return fail(res, 404, 'Pipeline not found');
            stages = activeStages(source)
                .sort(byOrder)
                .map(({ key, name: stageName, color, kind }) => ({ key, name: stageName, color, kind }));
        } else {
            return fail(res, 400, 'Start the pipeline from STANDARD, BLANK or COPY');
        }

        if (!enabled) stages = stages.filter((s) => s.kind !== 'ADMISSIONS');
        if (body.linkAdmissions === true) {
            if (!enabled) return fail(res, 400, 'Linking a pipeline to Admissions needs the Admissions module');
            if (!stages.some((s) => s.kind === 'ADMISSIONS')) {
                const won = stages.findIndex((s) => s.kind === 'WON');
                stages.splice(won + 1, 0, { ...HANDOFF });
            }
        }

        const validated = validateStages(stages, { admissionsEnabled: enabled });
        const pipeline = await Pipeline.create({
            businessId,
            name,
            isDefault: false,
            order: Math.max(0, ...pipelines.map((p) => p.order)) + 1,
            stages: validated,
        });
        return res.status(201).json({ success: true, data: { pipeline: view(pipeline, new Map()) } });
    } catch (error) {
        stageError(res, error, next);
    }
};

/**
 * PATCH /api/pipelines/:id — { name?, isDefault?: true, stages?, moves?: { removedKey: targetKey } }.
 * Stages left out are archived; a removed stage that still has leads needs a move.
 */
const updatePipeline = async (req, res, next) => {
    try {
        const pipeline = await findOwn(req, req.params.id);
        if (!pipeline) return fail(res, 404, 'Pipeline not found');
        const body = req.body || {};
        const businessId = req.user.businessId;

        if (body.name !== undefined) {
            const name = cleanName(body.name);
            if (!name) return fail(res, 400, 'Give the pipeline a name of 1 to 60 characters');
            if (await nameTaken(businessId, name, pipeline._id)) return fail(res, 409, 'A pipeline with that name already exists');
            pipeline.name = name;
        }
        if (body.isDefault !== undefined && body.isDefault !== true) {
            return fail(res, 400, 'Make a pipeline the default by setting isDefault: true on it');
        }

        const moves = [];
        let newlyLinkedLeadCount = 0;
        if (body.stages !== undefined) {
            const validated = validateStages(body.stages, { admissionsEnabled: await admissionsOn(businessId), existing: pipeline.stages });
            const kept = new Set(validated.map((s) => s.key));
            const removed = activeStages(pipeline).filter((s) => !kept.has(s.key));
            const leadsIn = (key) => Lead.countDocuments({ $and: [{ businessId, isArchived: { $ne: true }, status: key }, inPipeline(pipeline)] });
            const requested = body.moves && typeof body.moves === 'object' ? body.moves : {};

            const homeless = [];
            for (const stage of removed) {
                const leadCount = await leadsIn(stage.key);
                if (leadCount && !requested[stage.key]) homeless.push({ key: stage.key, name: stage.name, leadCount });
            }
            if (homeless.length) {
                return fail(res, 409, 'Some stages you removed still have leads. Choose where they go.', {
                    code: 'STAGES_HAVE_LEADS',
                    stages: homeless,
                });
            }
            for (const stage of removed) {
                if (!requested[stage.key]) continue;
                const target = validated.find((s) => s.key === requested[stage.key]);
                if (!target) return fail(res, 400, `Move the leads in "${stage.name}" to one of this pipeline's stages`);
                if (target.kind === 'ADMISSIONS') return fail(res, 400, NOT_A_HANDOFF);
                moves.push({ from: stage.key, to: target.key, toKind: target.kind });
            }

            const handoff = validated.find((s) => s.kind === 'ADMISSIONS');
            const before = handoff && pipeline.stages.find((s) => s.key === handoff.key);
            if (before && before.kind !== 'ADMISSIONS') newlyLinkedLeadCount = await leadsIn(handoff.key);

            const archived = [
                ...pipeline.stages.filter((s) => s.isArchived && !kept.has(s.key)).map(plain),
                ...removed.map((s) => ({ ...plain(s), isArchived: true })),
            ].map((s, i) => ({ ...s, order: validated.length + i }));
            pipeline.stages = [...validated, ...archived];
        }

        if (body.isDefault === true && !pipeline.isDefault) {
            const current = await Pipeline.findOne({ businessId, isDefault: true, isArchived: false });
            if (current) {
                // Leads that relied on "no pipeline means the default" stay on the old default
                await Lead.updateMany({ businessId, pipelineId: null }, { $set: { pipelineId: current._id } }, { timestamps: false });
                await Pipeline.updateOne({ _id: current._id }, { $set: { isDefault: false } });
            }
            pipeline.isDefault = true;
        }
        await pipeline.save();

        const now = new Date();
        for (const move of moves) {
            await Lead.updateMany(
                { $and: [{ businessId, status: move.from }, inPipeline(pipeline)] },
                {
                    $set: { status: move.to, lostReason: move.toKind === 'LOST' ? 'Stage removed' : '' },
                    $push: {
                        statusHistory: {
                            fromStatus: move.from,
                            toStatus: move.to,
                            pipelineId: pipeline._id,
                            changedBy: req.user.userId,
                            changedAt: now,
                            reason: 'Stage removed',
                        },
                    },
                }
            );
        }

        const pipelines = await listPipelines(businessId);
        return res.json({
            success: true,
            data: { pipeline: view(pipeline, await stageCounts(businessId, pipelines)), newlyLinkedLeadCount },
        });
    } catch (error) {
        stageError(res, error, next);
    }
};

/** DELETE /api/pipelines/:id — { moveTo?: { pipelineId, stageKey } }; archives the pipeline. */
const deletePipeline = async (req, res, next) => {
    try {
        const pipeline = await findOwn(req, req.params.id);
        if (!pipeline) return fail(res, 404, 'Pipeline not found');
        if (pipeline.isDefault) {
            return fail(res, 409, 'Make another pipeline the default before deleting this one', { code: 'DEFAULT_PIPELINE' });
        }
        const businessId = req.user.businessId;
        const moveTo = req.body?.moveTo;

        let target = null;
        let stage = null;
        if (moveTo) {
            target = await findOwn(req, moveTo.pipelineId);
            if (!target || String(target._id) === String(pipeline._id)) return fail(res, 400, 'Choose another pipeline for these leads');
            stage = activeStages(target).find((s) => s.key === moveTo.stageKey);
            if (!stage) return fail(res, 400, 'Choose one of that pipeline’s stages');
            if (stage.kind === 'ADMISSIONS') return fail(res, 400, NOT_A_HANDOFF);
        } else {
            const leadCount = await Lead.countDocuments({ businessId, pipelineId: pipeline._id, isArchived: { $ne: true } });
            if (leadCount) {
                return fail(res, 409, 'This pipeline still has leads. Choose where they go.', { code: 'PIPELINE_HAS_LEADS', leadCount });
            }
        }

        if (target) {
            const now = new Date();
            for (const from of await Lead.distinct('status', { businessId, pipelineId: pipeline._id })) {
                await Lead.updateMany(
                    { businessId, pipelineId: pipeline._id, status: from },
                    {
                        $set: { pipelineId: target._id, status: stage.key, lostReason: stage.kind === 'LOST' ? 'Pipeline removed' : '' },
                        $push: {
                            statusHistory: {
                                fromStatus: from,
                                toStatus: stage.key,
                                pipelineId: target._id,
                                changedBy: req.user.userId,
                                changedAt: now,
                                reason: 'Pipeline removed',
                            },
                        },
                    }
                );
            }
        }

        pipeline.isArchived = true;
        pipeline.isDefault = false;
        await pipeline.save();
        return res.json({ success: true, message: 'Pipeline deleted' });
    } catch (error) {
        next(error);
    }
};

module.exports = { getPipelines, createPipeline, updatePipeline, deletePipeline };
