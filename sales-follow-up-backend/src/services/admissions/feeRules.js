// Rules for the fee list. Pure functions over the config and an application
// (Mongoose document or plain object); no database access.
const { formatMinor } = require('./money');

/** Fee-list entries in use (archived ones are kept only for history). */
const activeFees = (config) => (config?.fees || []).filter((f) => !f.isArchived);

const findFee = (config, key) => (config?.fees || []).find((f) => f.key === key) || null;

const requirement = (value) => (value === true ? true : value === false ? false : null);

/**
 * Whether a fee's condition holds for this student: true, false, or null
 * while it is not known yet (for example, interview requirement not recorded).
 */
const conditionMet = (condition, application) => {
    const interview = requirement(application.assessment?.interviewRequired);
    const exam = requirement(application.assessment?.examRequired);

    switch (condition) {
        case null:
        case undefined:
            return true;
        case 'INTERVIEW_REQUIRED':
            return interview;
        case 'EXAM_REQUIRED':
            return exam;
        case 'INTERVIEW_OR_EXAM':
            if (interview === true || exam === true) return true;
            if (interview === false && exam === false) return false;
            return null;
        case 'BACHELOR':
            return application.studyLevel === 'BACHELOR';
        case 'MASTER':
            return application.studyLevel === 'MASTER';
        default:
            return false;
    }
};

const stageOrder = (config, key) => config.stages.find((s) => s.key === key)?.order ?? null;

/** The student is in this stage or has been past it. */
const hasReachedStage = (application, config, stageKey) => {
    if ((application.stageHistory || []).some((v) => v.stageKey === stageKey)) return true;
    const target = stageOrder(config, stageKey);
    const current = stageOrder(config, application.currentStageKey);
    return target !== null && current !== null && current >= target;
};

/** Whether the moment that adds this fee has already happened for the student. */
const triggerHappened = (entry, application, config) => {
    switch (entry.trigger) {
        case 'STAGE_ENTERED':
            return hasReachedStage(application, config, entry.stageKey);
        case 'ITEM_COMPLETED':
            return (application.checklist || []).some((e) => e.itemKey === entry.triggerItemKey && e.status === 'COMPLETED');
        case 'VISA_APPROVED':
            return application.visa?.outcome === 'APPROVED';
        default:
            return false;
    }
};

/**
 * Fee-list entries that an event adds to the student. Events:
 * { type: 'STAGES_ENTERED', stageKeys }  student reached these stages
 * { type: 'ITEM_COMPLETED', itemKey }    a checklist item was ticked
 * { type: 'VISA_APPROVED' }
 * { type: 'CONDITIONS_CHANGED', before } interview/exam/level changed; `before`
 *   holds the old assessment and studyLevel. Adds conditional fees whose moment
 *   already passed and whose condition has only now become true.
 */
const feesForEvent = (config, application, event) =>
    activeFees(config).filter((entry) => {
        if (entry.trigger === 'MANUAL') return false;

        if (event.type === 'CONDITIONS_CHANGED') {
            if (!entry.condition) return false;
            const was = conditionMet(entry.condition, event.before || {});
            return was !== true && conditionMet(entry.condition, application) === true && triggerHappened(entry, application, config);
        }

        if (conditionMet(entry.condition, application) !== true) return false;
        if (event.type === 'STAGES_ENTERED') return entry.trigger === 'STAGE_ENTERED' && event.stageKeys.includes(entry.stageKey);
        if (event.type === 'ITEM_COMPLETED') return entry.trigger === 'ITEM_COMPLETED' && entry.triggerItemKey === event.itemKey;
        if (event.type === 'VISA_APPROVED') return entry.trigger === 'VISA_APPROVED';
        return false;
    });

const openFeeFor = (application, key) =>
    (application.paymentSummary?.openScheduledFees || []).find((f) => f.scheduleKey === key) || null;

const describeOpen = (open) =>
    open.needsAmount ? 'amount not set yet' : `${formatMinor(open.outstandingMinor)} ${open.currency} outstanding`;

/** Unpaid fees that keep the student in this stage, shaped like missing checklist items. */
const stageFeeHolds = (application, config, stageKey) =>
    activeFees(config)
        .filter((entry) => entry.hold === 'STAGE' && entry.stageKey === stageKey)
        .map((entry) => ({ entry, open: openFeeFor(application, entry.key) }))
        .filter(({ open }) => open)
        .map(({ entry, open }) => ({
            stageKey,
            itemKey: `fee:${entry.key}`,
            feeKey: entry.key,
            label: `${open.name || entry.name} paid`,
            reason: describeOpen(open),
        }));

/** Why this checklist item cannot be ticked yet because of unpaid fees, or null. */
const itemFeeHold = (application, config, itemKey) => {
    const open = activeFees(config)
        .filter((entry) => entry.hold === 'ITEM' && entry.holdItemKey === itemKey)
        .map((entry) => openFeeFor(application, entry.key))
        .filter(Boolean);
    if (!open.length) return null;
    return `Waiting for payment: ${open.map((o) => `${o.name} (${describeOpen(o)})`).join(', ')}`;
};

module.exports = {
    activeFees,
    findFee,
    conditionMet,
    hasReachedStage,
    triggerHappened,
    feesForEvent,
    openFeeFor,
    stageFeeHolds,
    itemFeeHold,
};
