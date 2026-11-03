const AdmissionActivity = require('../../models/AdmissionActivity');
const { syncChecklist, setItemStatus } = require('../../services/admissions/checklist');
const { moveStage, isFinalStage, MIN_OVERRIDE_REASON } = require('../../services/admissions/stageService');
const { findApplicationInScope, isAdmin } = require('../../services/admissions/access');
const { getActiveStages } = require('../../services/admissions/configService');
const { logActivity } = require('../../services/admissions/activity');
const reminders = require('../../services/admissions/reminders');
const { getApplication } = require('./applicationController');

const STATUS_WORDS = { COMPLETED: 'completed', NOT_APPLICABLE: 'not applicable', PENDING: 'pending' };

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

const updateChecklistItem = async (req, res, next) => {
    try {
        const { status, reason } = req.body || {};
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');
        if (application.status !== 'ACTIVE') return fail(res, 409, 'This application is closed');

        syncChecklist(application, req.admissionsConfig);
        const result = setItemStatus(application, req.params.itemKey, { status, reason, userId: req.user.userId });
        if (!result.ok) return fail(res, result.status, result.message);

        await application.save();

        const why = status === 'NOT_APPLICABLE' ? ` (${result.entry.naReason})` : '';
        await logActivity({
            req,
            application,
            type: 'CHECKLIST_UPDATED',
            message: `"${result.entry.label}" marked ${STATUS_WORDS[status]}${why}`,
            meta: { itemKey: result.entry.itemKey, from: result.previous, to: status },
        });

        return getApplication(req, res, next);
    } catch (error) {
        next(error);
    }
};

const changeStage = async (req, res, next) => {
    try {
        const { toStageKey, fromStageKey, reason, override } = req.body || {};
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const result = await moveStage({
            req,
            application,
            config: req.admissionsConfig,
            toStageKey,
            fromStageKey,
            reason,
            override: override === true,
        });

        if (!result.ok) {
            return fail(res, result.status, result.message, {
                code: result.code,
                ...(result.data && { data: result.data }),
            });
        }

        const parts = [`Moved from ${result.from?.name ?? 'unknown stage'} to ${result.to.name}`];
        if (result.override) parts.push(`(admin override: ${result.reason})`);
        else if (result.reason) parts.push(`(${result.reason})`);

        await logActivity({
            req,
            application,
            type: 'STAGE_MOVED',
            message: parts.join(' '),
            meta: {
                from: result.from?.key,
                to: result.to.key,
                direction: result.direction,
                override: result.override,
                reason: result.reason,
                overriddenItems: result.overriddenItems,
            },
        });
        await reminders.syncRemindersForApplication(application._id);

        return getApplication(req, res, next);
    } catch (error) {
        next(error);
    }
};

/**
 * Records the final visa outcome and closes the application. Approval and
 * rejection are outcomes, not stages. Once recorded, only an admin can
 * correct it, with a reason.
 */
const recordVisaOutcome = async (req, res, next) => {
    try {
        const { outcome, reason } = req.body || {};
        const config = req.admissionsConfig;
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        if (!['APPROVED', 'REJECTED'].includes(outcome)) return fail(res, 400, 'Outcome must be APPROVED or REJECTED');

        const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
        const isCorrection = application.status === 'CLOSED' && application.visa.outcome !== 'PENDING';

        if (isCorrection) {
            if (!isAdmin(req)) return fail(res, 403, 'Only an admin can correct a recorded visa result');
            if (trimmedReason.length < MIN_OVERRIDE_REASON) {
                return fail(res, 400, 'Give a reason (at least 5 characters) for correcting the visa result');
            }
        } else {
            if (application.status !== 'ACTIVE') return fail(res, 409, 'This application is closed');
            if (!isFinalStage(application, config)) {
                const last = getActiveStages(config).at(-1);
                return fail(res, 409, `Move the student to the ${last?.name ?? 'final'} stage first`);
            }
        }

        const now = new Date();
        const previous = application.visa.outcome;
        application.visa.outcome = outcome;
        application.visa.outcomeAt = now;
        application.visa.outcomeBy = req.user.userId;

        if (!isCorrection) {
            syncChecklist(application, config);
            for (const entry of application.checklist) {
                if (entry.rule === 'VISA_OUTCOME_SET' && entry.status === 'PENDING') {
                    setItemStatus(application, entry.itemKey, { status: 'COMPLETED', userId: req.user.userId, now });
                }
            }
            const openVisit = application.stageHistory.find((v) => !v.exitedAt);
            if (openVisit) openVisit.exitedAt = now;
            application.status = 'CLOSED';
            application.closedAt = now;
        }

        await application.save();
        await reminders.syncRemindersForApplication(application._id);

        await logActivity({
            req,
            application,
            type: 'VISA_UPDATED',
            message: isCorrection
                ? `Visa result corrected from ${previous.toLowerCase()} to ${outcome.toLowerCase()}: ${trimmedReason}`
                : `Visa ${outcome === 'APPROVED' ? 'approved' : 'rejected'}`,
            meta: { from: previous, to: outcome },
        });

        return getApplication(req, res, next);
    } catch (error) {
        next(error);
    }
};

const listActivity = async (req, res, next) => {
    try {
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 500);
        const entries = await AdmissionActivity.find({ businessId: req.user.businessId, applicationId: application._id })
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit)
            .populate('actorId', 'name email role');

        return res.json({
            success: true,
            data: entries.map((e) => ({
                id: e._id,
                type: e.type,
                message: e.message,
                body: e.body,
                meta: e.meta,
                actor: e.actorId ? { id: e.actorId._id, name: e.actorId.name, role: e.actorId.role } : null,
                createdAt: e.createdAt,
            })),
        });
    } catch (error) {
        next(error);
    }
};

const addNote = async (req, res, next) => {
    try {
        const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');
        if (!body) return fail(res, 400, 'Write a note first');
        if (body.length > 5000) return fail(res, 400, 'Notes can be at most 5000 characters');

        const note = await logActivity({ req, application, type: 'NOTE', message: 'Note added', body });
        return res.status(201).json({ success: true, data: { id: note._id, body: note.body, createdAt: note.createdAt } });
    } catch (error) {
        next(error);
    }
};

module.exports = { updateChecklistItem, changeStage, recordVisaOutcome, listActivity, addNote };
