// Checklist rules. Works on Mongoose documents and plain objects alike.

const ITEM_STATUSES = ['PENDING', 'COMPLETED', 'NOT_APPLICABLE'];
const MIN_REASON_LENGTH = 3;

const hasResult = (value) => value === 'PASSED' || value === 'FAILED';

// Data that must exist before an item may be completed.
const RULE_CHECKS = {
    FINAL_CHOICE_SET: {
        passes: (app) => Boolean(app.finalChoice?.universityName?.trim()),
        message: "Record the student's final university and course first",
    },
    ASSESSMENT_REQUIREMENTS_SET: {
        passes: (app) =>
            typeof app.assessment?.interviewRequired === 'boolean' &&
            typeof app.assessment?.examRequired === 'boolean',
        message: 'Record whether an interview and an entrance exam are required first',
    },
    INTERVIEW_DATE_SET: {
        passes: (app) => Boolean(app.assessment?.interviewAt),
        message: 'Record the interview date first',
    },
    INTERVIEW_RESULT_SET: {
        passes: (app) => hasResult(app.assessment?.interviewResult),
        message: 'Record the interview result (passed or failed) first',
    },
    EXAM_DATE_SET: {
        passes: (app) => Boolean(app.assessment?.examAt),
        message: 'Record the entrance exam date first',
    },
    EXAM_RESULT_SET: {
        passes: (app) => hasResult(app.assessment?.examResult),
        message: 'Record the entrance exam result (passed or failed) first',
    },
    VISA_APPOINTMENT_SET: {
        passes: (app) => Boolean(app.visa?.appointmentAt),
        message: 'Record the visa appointment date first',
    },
    VISA_OUTCOME_SET: {
        passes: (app) => app.visa?.outcome === 'APPROVED' || app.visa?.outcome === 'REJECTED',
        message: 'Record the visa result (approved or rejected) first',
    },
};

const entryFromItem = (stageKey, item) => ({
    stageKey,
    itemKey: item.key,
    label: item.label,
    required: item.required !== false,
    condition: item.condition || null,
    rule: item.rule || null,
    paymentCategory: item.paymentCategory || null,
    isRetired: false,
    status: 'PENDING',
    naReason: '',
    completedBy: null,
    completedAt: null,
    updatedBy: null,
    updatedAt: null,
    history: [],
});

const activeStagesOf = (config) =>
    [...config.stages].filter((s) => !s.isArchived).sort((a, b) => a.order - b.order);

/** Snapshot of every active item in every active stage, all pending. */
const buildChecklist = (config) =>
    activeStagesOf(config).flatMap((stage) =>
        stage.items.filter((item) => !item.isArchived).map((item) => entryFromItem(stage.key, item))
    );

/**
 * Brings an application's checklist in line with the current configuration
 * without rewriting history:
 * - pending items follow config edits (label, required, condition, rule)
 * - pending items archived/removed in config are retired (no longer required)
 * - completed / not-applicable items keep what was recorded
 * - new config items are added only to stages the application hasn't passed
 * Returns true when anything changed.
 */
const syncChecklist = (application, config) => {
    let changed = false;
    const stageOrder = new Map(config.stages.map((s) => [s.key, s.order]));
    const currentOrder = stageOrder.get(application.currentStageKey) ?? 0;

    const configItems = new Map();
    for (const stage of config.stages) {
        for (const item of stage.items) {
            configItems.set(`${stage.key}:${item.key}`, { stage, item });
        }
    }

    for (const entry of application.checklist) {
        if (entry.status !== 'PENDING') continue;

        const match = configItems.get(`${entry.stageKey}:${entry.itemKey}`);
        const retired = !match || match.item.isArchived || match.stage.isArchived;

        if (retired) {
            if (!entry.isRetired) {
                entry.isRetired = true;
                changed = true;
            }
            continue;
        }

        const next = entryFromItem(entry.stageKey, match.item);
        for (const field of ['label', 'required', 'condition', 'rule', 'paymentCategory', 'isRetired']) {
            if (entry[field] !== next[field]) {
                entry[field] = next[field];
                changed = true;
            }
        }
    }

    const existing = new Set(application.checklist.map((e) => `${e.stageKey}:${e.itemKey}`));
    for (const stage of activeStagesOf(config)) {
        if (stage.order < currentOrder) continue;
        for (const item of stage.items) {
            if (item.isArchived || existing.has(`${stage.key}:${item.key}`)) continue;
            application.checklist.push(entryFromItem(stage.key, item));
            changed = true;
        }
    }

    return changed;
};

/** Whether an item applies to this application (conditional items depend on assessment). */
const isApplicable = (entry, application) => {
    if (entry.isRetired) return false;
    if (entry.condition === 'INTERVIEW_REQUIRED') return application.assessment?.interviewRequired === true;
    if (entry.condition === 'EXAM_REQUIRED') return application.assessment?.examRequired === true;
    return true;
};

/** null when the item's rule is satisfied, otherwise what must be recorded first. */
const checkRule = (entry, application) => {
    const check = entry.rule && RULE_CHECKS[entry.rule];
    if (!check || check.passes(application)) return null;
    return check.message;
};

const gateErrorFor = (stage, application) => {
    if (stage?.gate !== 'ASSESSMENT_PASSED') return null;

    const failures = [];
    if (application.assessment?.interviewRequired === true && application.assessment.interviewResult === 'FAILED') {
        failures.push('The interview was failed.');
    }
    if (application.assessment?.examRequired === true && application.assessment.examResult === 'FAILED') {
        failures.push('The entrance exam was failed.');
    }

    return failures.length ? `${failures.join(' ')} The application is flagged for review.` : null;
};

/**
 * Checks whether a stage's requirements are met.
 * missing: [{ stageKey, itemKey, label, reason }]; gateError: failed interview/exam.
 */
const evaluateStage = (application, stageKey, config) => {
    const stage = config.stages.find((s) => s.key === stageKey);
    const missing = [];

    for (const entry of application.checklist) {
        if (entry.stageKey !== stageKey || !entry.required || !isApplicable(entry, application)) continue;

        let reason = null;
        if (entry.status === 'PENDING') reason = 'Not completed yet';
        else if (entry.status === 'COMPLETED') reason = checkRule(entry, application);

        if (reason) {
            missing.push({ stageKey, itemKey: entry.itemKey, label: entry.label, reason });
        }
    }

    const gateError = gateErrorFor(stage, application);
    return { satisfied: missing.length === 0 && !gateError, missing, gateError };
};

/** Sets one item's status, recording who and when. Mutates the application. */
const setItemStatus = (application, itemKey, { status, reason = '', userId, now = new Date() }) => {
    const entry = application.checklist.find((e) => e.itemKey === itemKey);

    if (!entry) return { ok: false, status: 404, message: 'Checklist item not found' };
    if (entry.isRetired) return { ok: false, status: 400, message: 'This item is no longer part of the checklist' };
    if (!ITEM_STATUSES.includes(status)) return { ok: false, status: 400, message: 'Invalid checklist status' };

    const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';

    if (status === 'NOT_APPLICABLE' && trimmedReason.length < MIN_REASON_LENGTH) {
        return { ok: false, status: 400, message: 'Give a reason for marking this item not applicable' };
    }

    if (status === 'COMPLETED') {
        const ruleError = checkRule(entry, application);
        if (ruleError) return { ok: false, status: 400, message: ruleError };
    }

    const previous = entry.status;
    entry.status = status;
    entry.naReason = status === 'NOT_APPLICABLE' ? trimmedReason : '';
    entry.completedBy = status === 'COMPLETED' ? userId : null;
    entry.completedAt = status === 'COMPLETED' ? now : null;
    entry.updatedBy = userId;
    entry.updatedAt = now;
    entry.history.push({ status, reason: trimmedReason, by: userId, at: now });

    return { ok: true, entry, previous };
};

module.exports = {
    RULE_CHECKS,
    buildChecklist,
    syncChecklist,
    isApplicable,
    checkRule,
    evaluateStage,
    setItemStatus,
};
