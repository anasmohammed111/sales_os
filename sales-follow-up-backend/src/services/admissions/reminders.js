const Reminder = require('../../models/Reminder');
const Notification = require('../../models/Notification');
const Business = require('../../models/Business');
const FollowUp = require('../../models/FollowUp');
const AdmissionApplication = require('../../models/AdmissionApplication');
const AdmissionFee = require('../../models/AdmissionFee');
const AdmissionDocument = require('../../models/AdmissionDocument');
const { ensureConfig, findStage } = require('./configService');
const { stuckCondition } = require('./filters');
const { formatDateTime, formatDate } = require('./time');

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_PER_RUN = 500;

const dedupeKeyOf = (r) => `${r.kind}:${r.sourceId}:${r.eventAt.getTime()}:${r.userId}`;

/** Every reminder an application should currently have. */
const desiredReminders = async (application, config, now) => {
    if (application.status !== 'ACTIVE') return [];

    const defaults = config.reminderDefaults || {};
    const counsellorId = application.counsellorId;
    const desired = [];

    const add = (kind, sourceId, eventAt, userId, leadMs) => {
        if (!eventAt || !userId) return;
        const event = new Date(eventAt);
        if (event <= now) return;
        desired.push({ kind, sourceId, eventAt: event, userId, remindAt: new Date(event.getTime() - leadMs) });
    };

    const tasks = await FollowUp
        .find({ applicationId: application._id, status: 'PENDING', isArchived: { $ne: true } })
        .select('scheduledAt assignedTo');
    for (const task of tasks) {
        add('FOLLOW_UP', task._id, task.scheduledAt, task.assignedTo, (defaults.followUpMinutesBefore ?? 30) * MINUTE_MS);
    }

    const { assessment, visa } = application;
    if (assessment?.interviewRequired === true && assessment.interviewResult === 'PENDING') {
        add('INTERVIEW', application._id, assessment.interviewAt, counsellorId, (defaults.interviewDaysBefore ?? 2) * DAY_MS);
    }
    if (assessment?.examRequired === true && assessment.examResult === 'PENDING') {
        add('EXAM', application._id, assessment.examAt, counsellorId, (defaults.examDaysBefore ?? 2) * DAY_MS);
    }
    if (visa?.outcome === 'PENDING') {
        add('VISA_APPOINTMENT', application._id, visa.appointmentAt, counsellorId, (defaults.visaDaysBefore ?? 2) * DAY_MS);
    }

    const fees = await AdmissionFee
        .find({ applicationId: application._id, isArchived: { $ne: true }, outstandingMinor: { $gt: 0 }, dueDate: { $ne: null } })
        .select('dueDate');
    for (const fee of fees) {
        add('PAYMENT_DUE', fee._id, fee.dueDate, counsellorId, (defaults.paymentDaysBefore ?? 3) * DAY_MS);
    }

    const documents = await AdmissionDocument
        .find({ applicationId: application._id, isArchived: { $ne: true }, expiresAt: { $ne: null }, status: { $ne: 'REJECTED' } })
        .select('expiresAt');
    for (const doc of documents) {
        add('DOCUMENT_EXPIRY', doc._id, doc.expiresAt, counsellorId, (defaults.documentExpiryDaysBefore ?? 30) * DAY_MS);
    }

    return desired;
};

/**
 * Makes the stored reminders match what the application needs now.
 * Idempotent: unchanged reminders keep their row (and their sent state);
 * reminders no longer needed are cancelled.
 */
const syncRemindersForApplication = async (applicationId, now = new Date()) => {
    const application = await AdmissionApplication.findById(applicationId);
    if (!application) return;

    const config = await ensureConfig(application.businessId);
    const desired = await desiredReminders(application, config, now);
    const keys = desired.map(dedupeKeyOf);

    for (const reminder of desired) {
        try {
            await Reminder.updateOne(
                { dedupeKey: dedupeKeyOf(reminder) },
                {
                    $setOnInsert: {
                        businessId: application.businessId,
                        applicationId: application._id,
                        status: 'SCHEDULED',
                        ...reminder,
                    },
                },
                { upsert: true }
            );
        } catch (error) {
            if (error.code !== 11000) throw error; // a concurrent sync inserted it
        }
    }

    await Reminder.updateMany({ dedupeKey: { $in: keys }, status: 'CANCELLED' }, { $set: { status: 'SCHEDULED' } });
    await Reminder.updateMany(
        { applicationId: application._id, status: 'SCHEDULED', dedupeKey: { $nin: keys } },
        { $set: { status: 'CANCELLED' } }
    );
};

const REMINDER_TITLES = {
    FOLLOW_UP: 'Follow-up due',
    INTERVIEW: 'Interview coming up',
    EXAM: 'Entrance exam coming up',
    VISA_APPOINTMENT: 'Visa appointment coming up',
    PAYMENT_DUE: 'Payment due',
    DOCUMENT_EXPIRY: 'Document expiring',
};

/** Inserts a notification once per dedupe key; returns true if it was new. */
const notifyOnce = async (notification) => {
    const result = await Notification.updateOne(
        { dedupeKey: notification.dedupeKey },
        { $setOnInsert: { ...notification, isRead: false } },
        { upsert: true }
    );
    return result.upsertedCount === 1;
};

/**
 * Sends every reminder whose time has come, including ones missed while the
 * server was asleep. Each reminder is claimed atomically, so two workers
 * never send the same one.
 */
const processDueReminders = async (now = new Date()) => {
    const configs = new Map();
    let sent = 0;

    for (let i = 0; i < MAX_PER_RUN; i += 1) {
        const reminder = await Reminder.findOneAndUpdate(
            { status: 'SCHEDULED', remindAt: { $lte: now } },
            { $set: { status: 'SENT', sentAt: now } },
            { new: true, sort: { remindAt: 1 } }
        );
        if (!reminder) break;

        const application = await AdmissionApplication.findById(reminder.applicationId).select('student businessId status');
        if (!application || application.status !== 'ACTIVE') continue;

        const key = String(application.businessId);
        if (!configs.has(key)) configs.set(key, await ensureConfig(application.businessId));
        const timeZone = configs.get(key).timezone;

        const when = reminder.kind === 'FOLLOW_UP' ? formatDateTime(reminder.eventAt, timeZone) : formatDate(reminder.eventAt, timeZone);

        const created = await notifyOnce({
            businessId: application.businessId,
            userId: reminder.userId,
            applicationId: application._id,
            type: `REMINDER_${reminder.kind}`,
            title: `${REMINDER_TITLES[reminder.kind]}: ${application.student?.name || 'Student'}`,
            body: `Due ${when}`,
            link: `/admissions/students/${application._id}`,
            dedupeKey: `REMINDER:${reminder.dedupeKey}`,
        });
        if (created) sent += 1;
    }

    return sent;
};

/**
 * Notifies the counsellor (or the owner, when unassigned) once per stage
 * entry when an active application has stayed in a stage past its threshold.
 */
const runStuckCheck = async (now = new Date()) => {
    const businesses = await Business.find({ 'features.admissions': true, isActive: true }).select('_id owner');
    let created = 0;

    for (const business of businesses) {
        const config = await ensureConfig(business._id);
        const stuck = await AdmissionApplication
            .find({ businessId: business._id, ...stuckCondition(config, now) })
            .select('student counsellorId currentStageKey stageEnteredAt')
            .limit(MAX_PER_RUN);

        for (const application of stuck) {
            const recipient = application.counsellorId || business.owner;
            if (!recipient) continue;

            const stage = findStage(config, application.currentStageKey);
            const days = Math.floor((now - application.stageEnteredAt) / DAY_MS);
            const isNew = await notifyOnce({
                businessId: business._id,
                userId: recipient,
                applicationId: application._id,
                type: 'STUCK',
                title: `${application.student?.name || 'Student'} has been in ${stage?.name || 'a stage'} for ${days} days`,
                body: `The limit for this stage is ${stage?.stuckThresholdDays ?? 7} days.`,
                link: `/admissions/students/${application._id}`,
                dedupeKey: `STUCK:${application._id}:${application.currentStageKey}:${application.stageEnteredAt.getTime()}`,
            });
            if (isNew) created += 1;
        }
    }

    return created;
};

module.exports = {
    syncRemindersForApplication,
    processDueReminders,
    runStuckCheck,
    notifyOnce,
};
