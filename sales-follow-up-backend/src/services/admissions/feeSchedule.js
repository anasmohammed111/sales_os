// Applies the fee list to students: adds fees at their step, ticks checklist
// items that only waited for a payment, and describes the fees still ahead.
const AdmissionFee = require('../../models/AdmissionFee');
const AdmissionApplication = require('../../models/AdmissionApplication');
const { activeFees, conditionMet, triggerHappened, feesForEvent, itemFeeHold } = require('./feeRules');
const { syncChecklist, setItemStatus, checkRule } = require('./checklist');
const { isOpen, refreshApplicationPayments } = require('./payments');
const { formatMinor } = require('./money');
const { logActivity } = require('./activity');
const reminders = require('./reminders');

const DAY_MS = 24 * 60 * 60 * 1000;

const amountText = (fee) => (fee.needsAmount ? 'amount to be set' : `${formatMinor(fee.amountDueMinor)} ${fee.currency}`);

/** A new fee record from a fee-list entry. */
const feeFromEntry = (entry, { businessId, applicationId, userId, now = new Date() }) => ({
    businessId,
    applicationId,
    category: entry.category,
    label: entry.name,
    amountDueMinor: entry.amountMinor ?? 0,
    needsAmount: entry.amountMinor === null || entry.amountMinor === undefined,
    currency: entry.currency,
    dueDate: new Date(now.getTime() + (entry.dueInDays ?? 7) * DAY_MS),
    scheduleKey: entry.key,
    stageKey: entry.stageKey,
    refundable: entry.refundable === true,
    createdBy: userId,
});

/**
 * Adds the fees an event triggers (see feeRules.feesForEvent). A fee-list
 * entry is added to a student automatically only once: never again after
 * it was added, even if staff removed it since.
 */
const raiseFees = async ({ req, application, config, event, now = new Date() }) => {
    if (application.status !== 'ACTIVE' && event.type !== 'VISA_APPROVED') return [];
    const entries = feesForEvent(config, application, event);
    if (!entries.length) return [];

    const existing = await AdmissionFee.find({
        applicationId: application._id,
        scheduleKey: { $in: entries.map((e) => e.key) },
    }).select('scheduleKey');
    const alreadyAdded = new Set(existing.map((f) => f.scheduleKey));

    const created = [];
    for (const entry of entries) {
        if (alreadyAdded.has(entry.key)) continue;
        try {
            created.push(
                await AdmissionFee.create(
                    feeFromEntry(entry, {
                        businessId: application.businessId,
                        applicationId: application._id,
                        userId: req.user.userId,
                        now,
                    })
                )
            );
        } catch (error) {
            // A parallel request added it first
            if (error.code !== 11000) throw error;
        }
    }
    if (!created.length) return created;

    await refreshApplicationPayments(application._id);
    await reminders.syncRemindersForApplication(application._id);
    for (const fee of created) {
        await logActivity({
            req,
            application,
            type: 'FEE_ADDED',
            message: `${fee.label} added from the fee list: ${amountText(fee)}`,
            meta: { feeId: fee._id, scheduleKey: fee.scheduleKey },
        });
    }
    return created;
};

/** Stage keys a forward move passes into: every stage after `fromKey` up to and including `toKey`. */
const stagesEntered = (config, fromKey, toKey) => {
    const orderOf = (key) => config.stages.find((s) => s.key === key)?.order ?? 0;
    const from = orderOf(fromKey);
    const to = orderOf(toKey);
    return config.stages.filter((s) => !s.isArchived && s.order > from && s.order <= to).map((s) => s.key);
};

/**
 * Ticks checklist items that only waited for a payment (fee-list entries with
 * autoCompleteItem) once the fee is paid and nothing else holds the item.
 * Ticking an item can in turn add the fees it triggers.
 */
const autoCompleteHeldItems = async ({ req, applicationId, config, now = new Date() }) => {
    const autoEntries = activeFees(config).filter((e) => e.hold === 'ITEM' && e.autoCompleteItem && e.holdItemKey);
    if (!autoEntries.length) return [];

    const application = await AdmissionApplication.findById(applicationId);
    if (!application || application.status !== 'ACTIVE') return [];
    syncChecklist(application, config);

    const fees = await AdmissionFee.find({
        applicationId,
        scheduleKey: { $in: autoEntries.map((e) => e.key) },
        isArchived: false,
    });

    const ticked = [];
    for (const itemKey of new Set(autoEntries.map((e) => e.holdItemKey))) {
        const entry = application.checklist.find((c) => c.itemKey === itemKey);
        if (!entry || entry.status !== 'PENDING' || entry.isRetired) continue;

        const keys = new Set(autoEntries.filter((e) => e.holdItemKey === itemKey).map((e) => e.key));
        const paying = fees.filter((f) => keys.has(f.scheduleKey));
        if (!paying.length || paying.some(isOpen)) continue;
        if (itemFeeHold(application, config, itemKey) || checkRule(entry, application)) continue;

        const result = setItemStatus(application, itemKey, { status: 'COMPLETED', reason: 'Payment received', userId: req.user.userId, now });
        if (result.ok) ticked.push(result.entry);
    }
    if (!ticked.length) return ticked;

    await application.save();
    for (const entry of ticked) {
        await logActivity({
            req,
            application,
            type: 'CHECKLIST_UPDATED',
            message: `"${entry.label}" marked completed: payment received`,
            meta: { itemKey: entry.itemKey, from: 'PENDING', to: 'COMPLETED', automatic: true },
        });
        await raiseFees({ req, application, config, event: { type: 'ITEM_COMPLETED', itemKey: entry.itemKey }, now });
    }
    return ticked;
};

/**
 * The fee-list entries not currently on the student, and what will happen to each:
 * UPCOMING   its moment hasn't come yet; it will be added automatically
 * NOT_ADDED  its moment passed without it being added (students from before the
 *            fee list, fees added to the list later, or removed by staff)
 * OPTIONAL   added by hand only
 * NOT_NEEDED its condition doesn't apply, or the application is closed
 */
const planFor = (application, config, fees) => {
    const onStudent = new Set(fees.filter((f) => !f.isArchived && f.scheduleKey).map((f) => f.scheduleKey));
    const stage = (key) => config.stages.find((s) => s.key === key);
    const itemLabel = (key) => config.stages.flatMap((s) => s.items).find((i) => i.key === key)?.label ?? null;
    const currentOrder = stage(application.currentStageKey)?.order ?? 0;
    // Item-triggered fees of a stage the student has already left count as missed
    const missedItem = (entry) => entry.trigger === 'ITEM_COMPLETED' && currentOrder > (stage(entry.stageKey)?.order ?? 0);

    return activeFees(config)
        .filter((entry) => !onStudent.has(entry.key))
        .map((entry) => {
            const condition = conditionMet(entry.condition, application);
            let state = 'UPCOMING';
            if (entry.trigger === 'MANUAL') state = 'OPTIONAL';
            else if (condition === false) state = 'NOT_NEEDED';
            else if (condition === true && (triggerHappened(entry, application, config) || missedItem(entry))) state = 'NOT_ADDED';
            else if (application.status !== 'ACTIVE') state = 'NOT_NEEDED';

            return {
                key: entry.key,
                name: entry.name,
                category: entry.category,
                amountMinor: entry.amountMinor ?? null,
                amount: entry.amountMinor ? formatMinor(entry.amountMinor) : null,
                currency: entry.currency,
                stageKey: entry.stageKey,
                stageName: stage(entry.stageKey)?.name ?? entry.stageKey,
                stageOrder: stage(entry.stageKey)?.order ?? 0,
                trigger: entry.trigger,
                triggerItemLabel: entry.triggerItemKey ? itemLabel(entry.triggerItemKey) : null,
                condition: entry.condition,
                hold: entry.hold,
                holdItemLabel: entry.holdItemKey ? itemLabel(entry.holdItemKey) : null,
                state,
            };
        })
        .sort((a, b) => a.stageOrder - b.stageOrder);
};

module.exports = { feeFromEntry, raiseFees, stagesEntered, autoCompleteHeldItems, planFor, amountText };
