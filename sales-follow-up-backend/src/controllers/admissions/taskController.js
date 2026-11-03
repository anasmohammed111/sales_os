const mongoose = require('mongoose');
const FollowUp = require('../../models/FollowUp');
const AdmissionApplication = require('../../models/AdmissionApplication');
const {
    findApplicationInScope,
    getScopedCounsellorIds,
    validateCounsellor,
} = require('../../services/admissions/access');
const { TASK_TYPES, TASK_PRIORITIES, TASK_STATUSES, refreshNextFollowUp } = require('../../services/admissions/tasks');
const { toDate } = require('../../services/admissions/filters');
const { logActivity } = require('../../services/admissions/activity');
const reminders = require('../../services/admissions/reminders');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const serializeTask = (task, application) => ({
    id: task._id,
    applicationId: task.applicationId,
    studentId: task.leadId,
    student: application?.student ? { name: application.student.name, phone: application.student.phone } : null,
    currentStageKey: application?.currentStageKey ?? null,
    type: task.type,
    title: task.title,
    notes: task.notes,
    outcome: task.outcome,
    priority: task.priority,
    status: task.status,
    scheduledAt: task.scheduledAt,
    completedAt: task.completedAt,
    assignedTo: task.assignedTo?.name
        ? { id: task.assignedTo._id, name: task.assignedTo.name }
        : task.assignedTo
          ? { id: task.assignedTo }
          : null,
    createdAt: task.createdAt,
});

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);

/** Validates editable task fields. Returns { value } or { error }. */
const validateTaskInput = (body, { partial }) => {
    const value = {};

    if (!partial || body.type !== undefined) {
        if (!TASK_TYPES.includes(body.type)) return { error: 'Choose a valid task type' };
        value.type = body.type;
    }

    if (!partial || body.scheduledAt !== undefined) {
        const date = toDate(body.scheduledAt);
        if (!date) return { error: 'Choose a valid due date and time' };
        value.scheduledAt = date;
    }

    if (body.priority !== undefined) {
        if (!TASK_PRIORITIES.includes(body.priority)) return { error: 'Priority must be low, medium or high' };
        value.priority = body.priority;
    }

    if (body.title !== undefined) value.title = text(body.title, 200) ?? '';
    if (body.notes !== undefined) value.notes = text(body.notes, 2000) ?? '';
    if (body.outcome !== undefined) value.outcome = text(body.outcome, 2000) ?? '';

    return { value };
};

/** Loads a task if the user may work on it: its application is in scope, or it is assigned to them. */
const findTaskInScope = async (req, id) => {
    if (!mongoose.isValidObjectId(id)) return null;
    const task = await FollowUp.findOne({ _id: id, businessId: req.user.businessId, applicationId: { $ne: null } });
    if (!task) return null;

    const application = await findApplicationInScope(req, task.applicationId);
    if (application) return { task, application };

    if (task.assignedTo && String(task.assignedTo) === String(req.user.userId)) {
        return { task, application: await AdmissionApplication.findById(task.applicationId) };
    }
    return null;
};

const listTasks = async (req, res, next) => {
    try {
        const filter = { businessId: req.user.businessId, applicationId: { $ne: null }, isArchived: { $ne: true } };

        const assignedTo = req.query.assignedTo;
        if (!assignedTo) {
            filter.assignedTo = req.user.userId;
        } else if (assignedTo === 'ALL') {
            const scoped = await getScopedCounsellorIds(req);
            if (scoped) filter.assignedTo = { $in: scoped };
        } else {
            const scoped = await getScopedCounsellorIds(req);
            if (!mongoose.isValidObjectId(assignedTo)) return fail(res, 400, 'Invalid staff member');
            if (scoped && !scoped.some((id) => String(id) === String(assignedTo))) {
                return fail(res, 403, 'You can only view your own or your team’s tasks');
            }
            filter.assignedTo = assignedTo;
        }

        const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
        if (TASK_STATUSES.includes(status)) filter.status = status;

        if (mongoose.isValidObjectId(req.query.applicationId)) filter.applicationId = req.query.applicationId;

        const from = toDate(req.query.from);
        const to = toDate(req.query.to);
        if (from || to) filter.scheduledAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

        const tasks = await FollowUp.find(filter).sort({ scheduledAt: 1 }).limit(500).populate('assignedTo', 'name');

        const applications = await AdmissionApplication.find({
            _id: { $in: [...new Set(tasks.map((t) => String(t.applicationId)))] },
        }).select('student currentStageKey');
        const byId = new Map(applications.map((a) => [String(a._id), a]));

        return res.json({ success: true, data: tasks.map((t) => serializeTask(t, byId.get(String(t.applicationId)))) });
    } catch (error) {
        next(error);
    }
};

const listApplicationTasks = async (req, res, next) => {
    try {
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const tasks = await FollowUp.find({ businessId: req.user.businessId, applicationId: application._id, isArchived: { $ne: true } })
            .sort({ status: -1, scheduledAt: 1 })
            .populate('assignedTo', 'name');

        return res.json({ success: true, data: tasks.map((t) => serializeTask(t, application)) });
    } catch (error) {
        next(error);
    }
};

const createTask = async (req, res, next) => {
    try {
        const body = req.body || {};
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const input = validateTaskInput(body, { partial: false });
        if (input.error) return fail(res, 400, input.error);

        const assigneeInput = body.assignedTo ?? application.counsellorId ?? req.user.userId;
        const assignee = await validateCounsellor(req, String(assigneeInput));
        if (assignee.error) return fail(res, assignee.status, assignee.error);

        const task = await FollowUp.create({
            businessId: req.user.businessId,
            leadId: application.studentId,
            applicationId: application._id,
            assignedTo: assignee.counsellorId,
            createdBy: req.user.userId,
            priority: 'MEDIUM',
            ...input.value,
        });

        await refreshNextFollowUp(application._id);
        await reminders.syncRemindersForApplication(application._id);
        await logActivity({
            req,
            application,
            type: 'TASK_CREATED',
            message: `Task added: ${task.title || task.type.toLowerCase()} due ${task.scheduledAt.toISOString()}`,
            meta: { taskId: task._id },
        });

        await task.populate('assignedTo', 'name');
        return res.status(201).json({ success: true, data: serializeTask(task, application) });
    } catch (error) {
        next(error);
    }
};

const updateTask = async (req, res, next) => {
    try {
        const body = req.body || {};
        const found = await findTaskInScope(req, req.params.id);
        if (!found) return fail(res, 404, 'Task not found');
        const { task, application } = found;

        const input = validateTaskInput(body, { partial: true });
        if (input.error) return fail(res, 400, input.error);
        Object.assign(task, input.value);

        const changes = [];
        if (input.value.scheduledAt) changes.push(`rescheduled to ${input.value.scheduledAt.toISOString()}`);

        if (body.status !== undefined) {
            if (!TASK_STATUSES.includes(body.status)) return fail(res, 400, 'Invalid task status');
            task.status = body.status;
            task.completedAt = body.status === 'COMPLETED' ? new Date() : null;
            changes.push(`marked ${body.status.toLowerCase()}`);
        }

        if (body.assignedTo !== undefined) {
            const assignee = await validateCounsellor(req, body.assignedTo);
            if (assignee.error) return fail(res, assignee.status, assignee.error);
            task.assignedTo = assignee.counsellorId;
            changes.push('reassigned');
        }

        await task.save();
        await refreshNextFollowUp(task.applicationId);
        await reminders.syncRemindersForApplication(task.applicationId);

        if (application && changes.length) {
            await logActivity({
                req,
                application,
                type: 'TASK_UPDATED',
                message: `Task "${task.title || task.type.toLowerCase()}" ${changes.join(', ')}`,
                meta: { taskId: task._id },
            });
        }

        await task.populate('assignedTo', 'name');
        return res.json({ success: true, data: serializeTask(task, application) });
    } catch (error) {
        next(error);
    }
};

module.exports = { listTasks, listApplicationTasks, createTask, updateTask };
