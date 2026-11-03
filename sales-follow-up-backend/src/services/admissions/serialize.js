const { findStage, getActiveStages } = require('./configService');
const { evaluateStage, isApplicable, checkRule } = require('./checklist');
const { DAY_MS } = require('./filters');

const personOf = (value) =>
    value && typeof value === 'object' && value.name
        ? { id: value._id, name: value.name, email: value.email, role: value.role, isActive: value.isActive !== false }
        : null;

const idOf = (value) => (value && typeof value === 'object' && value._id ? value._id : value) || null;

/** The stage after the current one in pipeline order, or null at the end. */
const nextStageOf = (application, config) => {
    const stages = getActiveStages(config);
    const current = findStage(config, application.currentStageKey);
    return stages.find((s) => s.order > (current?.order ?? 0)) || null;
};

/** Compact JSON used by lists and the pipeline board. */
const serializeApplication = (application, config, now = new Date()) => {
    const stage = findStage(config, application.currentStageKey);
    const isActive = application.status === 'ACTIVE';
    const msInStage = Math.max(0, now - new Date(application.stageEnteredAt));
    const stuckThresholdDays = stage?.stuckThresholdDays ?? 7;

    const isStuck = isActive && msInStage > stuckThresholdDays * DAY_MS;
    const isFollowUpOverdue = Boolean(isActive && application.nextFollowUpAt && application.nextFollowUpAt < now);
    const isPaymentOverdue = Boolean(
        isActive && application.paymentSummary?.nextDueAt && application.paymentSummary.nextDueAt < now
    );
    const evaluation = evaluateStage(application, application.currentStageKey, config);
    const nextStage = nextStageOf(application, config);

    const warnings = [];
    if (application.needsReview) warnings.push('NEEDS_REVIEW');
    if (isStuck) warnings.push('STUCK');
    if (isFollowUpOverdue) warnings.push('FOLLOW_UP_OVERDUE');
    if (isPaymentOverdue) warnings.push('PAYMENT_OVERDUE');
    if (isActive && !application.nextFollowUpAt) warnings.push('NO_FOLLOW_UP');
    if (isActive && !application.counsellorId) warnings.push('UNASSIGNED');

    return {
        id: application._id,
        studentId: idOf(application.studentId),
        student: application.student,
        counsellorId: idOf(application.counsellorId),
        counsellor: personOf(application.counsellorId),
        studyLevel: application.studyLevel,
        intakeMonth: application.intakeMonth,
        intakeYear: application.intakeYear,
        leadSource: application.leadSource,
        shortlist: application.shortlist,
        finalChoice: application.finalChoice,
        currentStage: stage
            ? { key: stage.key, name: stage.name, order: stage.order, isArchived: stage.isArchived }
            : { key: application.currentStageKey, name: application.currentStageKey, order: 0, isArchived: true },
        nextStage: nextStage ? { key: nextStage.key, name: nextStage.name } : null,
        stageEnteredAt: application.stageEnteredAt,
        daysInStage: Math.floor(msInStage / DAY_MS),
        stuckThresholdDays,
        isStuck,
        status: application.status,
        closedAt: application.closedAt,
        withdrawnReason: application.withdrawnReason,
        needsReview: application.needsReview,
        reviewReason: application.reviewReason,
        assessment: application.assessment,
        visa: application.visa,
        nextFollowUpAt: application.nextFollowUpAt,
        isFollowUpOverdue,
        paymentSummary: application.paymentSummary,
        isPaymentOverdue,
        pendingRequirements: evaluation.missing.length,
        canAdvance: Boolean(isActive && nextStage && evaluation.satisfied),
        warnings,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
    };
};

/** Full profile JSON: adds the checklist, stage history and per-stage progress. */
const serializeApplicationDetail = (application, config, now = new Date()) => {
    const base = serializeApplication(application, config, now);
    const stageKeys = new Set(application.checklist.map((e) => e.stageKey));
    const stages = [...config.stages]
        .filter((s) => !s.isArchived || stageKeys.has(s.key))
        .sort((a, b) => a.order - b.order);

    const stageProgress = stages.map((stage) => {
        const entries = application.checklist.filter(
            (e) => e.stageKey === stage.key && e.required && isApplicable(e, application)
        );
        const evaluation = evaluateStage(application, stage.key, config);
        return {
            key: stage.key,
            name: stage.name,
            order: stage.order,
            isArchived: stage.isArchived,
            required: entries.length,
            done: entries.length - evaluation.missing.length,
            satisfied: evaluation.satisfied,
        };
    });

    const current = evaluateStage(application, application.currentStageKey, config);

    return {
        ...base,
        checklist: application.checklist.map((entry) => ({
            stageKey: entry.stageKey,
            itemKey: entry.itemKey,
            label: entry.label,
            required: entry.required,
            condition: entry.condition,
            rule: entry.rule,
            paymentCategory: entry.paymentCategory,
            isRetired: entry.isRetired,
            isApplicable: isApplicable(entry, application),
            blockedBy: entry.status === 'PENDING' ? checkRule(entry, application) : null,
            status: entry.status,
            naReason: entry.naReason,
            completedBy: personOf(entry.completedBy) || idOf(entry.completedBy),
            completedAt: entry.completedAt,
            updatedAt: entry.updatedAt,
            history: entry.history,
        })),
        stageHistory: application.stageHistory,
        stageProgress,
        currentRequirements: { missing: current.missing, gateError: current.gateError },
    };
};

module.exports = { serializeApplication, serializeApplicationDetail, nextStageOf };
