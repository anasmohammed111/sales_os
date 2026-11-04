const AdmissionApplication = require('../../models/AdmissionApplication');
const { findStage, getActiveStages } = require('./configService');
const { evaluateStage, syncChecklist } = require('./checklist');
const { can } = require('../access');

const MIN_OVERRIDE_REASON = 5;

const failure = (status, code, message, data) => ({ ok: false, status, code, message, data });

/**
 * Moves an application to another stage. Every interface (drag-and-drop,
 * profile button, mobile action) goes through here.
 *
 * Forward moves require the current stage and every skipped stage to be
 * satisfied, unless an admin overrides with a reason. Backward moves are
 * always allowed and logged. `fromStageKey` guards against stale moves.
 */
const moveStage = async ({ req, application, config, toStageKey, fromStageKey, reason, override = false, now = new Date() }) => {
    if (application.status !== 'ACTIVE') {
        return failure(409, 'APPLICATION_CLOSED', 'This application is closed and can no longer change stage');
    }

    if (fromStageKey !== application.currentStageKey) {
        return failure(409, 'STAGE_CONFLICT', 'This student was moved by someone else. Refresh and try again.');
    }

    const current = findStage(config, application.currentStageKey);
    const target = findStage(config, toStageKey);
    if (!target || target.isArchived) return failure(400, 'INVALID_STAGE', 'Choose a valid stage');
    if (target.key === application.currentStageKey) {
        return failure(400, 'INVALID_STAGE', 'The student is already in this stage');
    }

    syncChecklist(application, config);

    const currentOrder = current?.order ?? 0;
    const direction = target.order > currentOrder ? 'FORWARD' : 'BACKWARD';
    const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    let overriddenItems = [];

    if (direction === 'FORWARD') {
        const crossed = [current, ...getActiveStages(config).filter((s) => s.order > currentOrder && s.order < target.order)]
            .filter(Boolean);

        const missing = [];
        const gateErrors = [];
        for (const stage of crossed) {
            const result = evaluateStage(application, stage.key, config);
            missing.push(...result.missing);
            if (result.gateError) gateErrors.push(result.gateError);
        }

        if (missing.length || gateErrors.length) {
            if (!override) {
                return failure(422, 'STAGE_REQUIREMENTS_MISSING', `Complete these before moving to ${target.name}`, {
                    missing,
                    gateError: gateErrors.join(' ') || null,
                });
            }
            if (!can(req, 'admissions.override')) {
                return failure(403, 'OVERRIDE_NOT_ALLOWED', 'You do not have permission to override stage requirements');
            }
            if (trimmedReason.length < MIN_OVERRIDE_REASON) {
                return failure(400, 'OVERRIDE_REASON_REQUIRED', 'Give a reason (at least 5 characters) for the override');
            }
            overriddenItems = [...missing.map((m) => m.label), ...gateErrors];
        }
    }

    const stageHistory = application.stageHistory.map((visit) => {
        const plain = visit.toObject ? visit.toObject() : { ...visit };
        if (!plain.exitedAt) plain.exitedAt = now;
        return plain;
    });
    stageHistory.push({
        stageKey: target.key,
        stageName: target.name,
        enteredAt: now,
        exitedAt: null,
        enteredBy: req.user.userId,
        direction,
        override: overriddenItems.length > 0,
        reason: trimmedReason,
        overriddenItems,
    });

    // Conditional write: only applies if nobody moved the student meanwhile
    const result = await AdmissionApplication.updateOne(
        {
            _id: application._id,
            status: 'ACTIVE',
            currentStageKey: fromStageKey,
            stageEnteredAt: application.stageEnteredAt,
        },
        {
            $set: {
                currentStageKey: target.key,
                stageEnteredAt: now,
                stageHistory,
                checklist: application.checklist,
            },
        }
    );

    if (result.modifiedCount === 0) {
        return failure(409, 'STAGE_CONFLICT', 'This student was moved by someone else. Refresh and try again.');
    }

    return {
        ok: true,
        from: current,
        to: target,
        direction,
        override: overriddenItems.length > 0,
        overriddenItems,
        reason: trimmedReason,
    };
};

/** The last active stage is where visa outcomes are recorded. */
const isFinalStage = (application, config) => {
    const stages = getActiveStages(config);
    return stages.length > 0 && stages[stages.length - 1].key === application.currentStageKey;
};

module.exports = { moveStage, isFinalStage, MIN_OVERRIDE_REASON };
