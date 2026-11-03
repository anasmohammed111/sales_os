const mongoose = require('mongoose');

const TASK_TYPES = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'TASK', 'DOCUMENT', 'PAYMENT', 'EXAM', 'INTERVIEW', 'VISA', 'OTHER'];
const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const TASK_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'];

/** Recomputes an application's next follow-up from its earliest pending task. */
const refreshNextFollowUp = async (applicationId) => {
    if (!applicationId) return;
    const FollowUp = mongoose.model('FollowUp');
    const AdmissionApplication = mongoose.model('AdmissionApplication');

    const next = await FollowUp.findOne({ applicationId, status: 'PENDING', isArchived: { $ne: true } })
        .sort({ scheduledAt: 1 })
        .select('scheduledAt');

    await AdmissionApplication.updateOne({ _id: applicationId }, { $set: { nextFollowUpAt: next?.scheduledAt ?? null } });
};

module.exports = { TASK_TYPES, TASK_PRIORITIES, TASK_STATUSES, refreshNextFollowUp };
