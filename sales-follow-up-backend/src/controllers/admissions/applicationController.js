const mongoose = require('mongoose');
const Lead = require('../../models/Leads');
const FollowUp = require('../../models/FollowUp');
const User = require('../../models/User');
const University = require('../../models/University');
const AdmissionApplication = require('../../models/AdmissionApplication');
const { STUDY_LEVELS, ASSESSMENT_RESULTS } = require('../../models/AdmissionApplication');
const { getActiveStages } = require('../../services/admissions/configService');
const { buildChecklist, syncChecklist } = require('../../services/admissions/checklist');
const {
    getApplicationScope,
    getScopedCounsellorIds,
    findApplicationInScope,
    validateCounsellor,
} = require('../../services/admissions/access');
const {
    mapLeadSource,
    snapshotFromLead,
    validateStudentInput,
    isStudentInScope,
    findDuplicateStudents,
} = require('../../services/admissions/students');
const { buildApplicationQuery, toDate } = require('../../services/admissions/filters');
const { serializeApplication, serializeApplicationDetail } = require('../../services/admissions/serialize');
const { logActivity } = require('../../services/admissions/activity');
const reminders = require('../../services/admissions/reminders');
const { raiseFees } = require('../../services/admissions/feeSchedule');

const COUNSELLOR_FIELDS = 'name email role isActive';
const ASSESSMENT_REVIEW_REASONS = ['Interview failed', 'Entrance exam failed', 'Interview and entrance exam failed'];

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

const loadForResponse = (id) => AdmissionApplication.findById(id).populate('counsellorId', COUNSELLOR_FIELDS);

/** Validates level, intake and lead source. With partial=true only present fields are checked. */
const validateAdmissionInput = (body, config, { partial = false } = {}) => {
    const value = {};

    if (!partial || body.studyLevel !== undefined) {
        if (!STUDY_LEVELS.includes(body.studyLevel)) return { error: "Choose Bachelor's or Master's" };
        value.studyLevel = body.studyLevel;
    }

    if (!partial || body.intakeMonth !== undefined) {
        const month = Number(body.intakeMonth);
        if (!Number.isInteger(month) || month < 1 || month > 12) return { error: 'Intake month must be between 1 and 12' };
        value.intakeMonth = month;
    }

    if (!partial || body.intakeYear !== undefined) {
        const year = Number(body.intakeYear);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'Enter a valid intake year' };
        value.intakeYear = year;
    }

    if (!partial || body.leadSource !== undefined) {
        const valid = config.leadSources.some((s) => s.key === body.leadSource && !s.isArchived);
        if (!valid) return { error: 'Choose a valid lead source' };
        value.leadSource = body.leadSource;
    }

    return { value };
};

/** Resolves a university/course choice; known universities take names from master data. */
const resolveChoice = async (businessId, choice) => {
    if (!choice || typeof choice !== 'object') return null;

    if (mongoose.isValidObjectId(choice.universityId)) {
        const university = await University.findOne({ _id: choice.universityId, businessId });
        if (!university) return { error: 'University not found' };
        const course = mongoose.isValidObjectId(choice.courseId) ? university.courses.id(choice.courseId) : null;
        return {
            universityId: university._id,
            courseId: course?._id || null,
            universityName: university.name,
            courseName: course?.name || (typeof choice.courseName === 'string' ? choice.courseName.trim().slice(0, 150) : ''),
        };
    }

    const universityName = typeof choice.universityName === 'string' ? choice.universityName.trim().slice(0, 150) : '';
    const courseName = typeof choice.courseName === 'string' ? choice.courseName.trim().slice(0, 150) : '';
    if (!universityName && !courseName) return { universityId: null, courseId: null, universityName: '', courseName: '' };
    return { universityId: null, courseId: null, universityName, courseName };
};

const parseOptionalDate = (value) => {
    if (value === null || value === '') return { value: null };
    const date = toDate(value);
    return date ? { value: date } : { error: 'Invalid date' };
};

const checkDuplicates = async (req, res, next) => {
    try {
        const { email, phone, excludeStudentId } = req.body || {};
        const matches = await findDuplicateStudents(req, { email, phone, excludeStudentId });
        return res.json({ success: true, data: { matches } });
    } catch (error) {
        next(error);
    }
};

const createApplication = async (req, res, next) => {
    let createdLeadId = null;

    try {
        const body = req.body || {};
        const config = req.admissionsConfig;

        const admission = validateAdmissionInput(body, config);
        if (admission.error) return fail(res, 400, admission.error);

        const counsellorInput = body.counsellorId === undefined ? req.user.userId : body.counsellorId;
        const counsellor = await validateCounsellor(req, counsellorInput);
        if (counsellor.error) return fail(res, counsellor.status, counsellor.error);

        let lead;
        if (body.studentId !== undefined) {
            lead = mongoose.isValidObjectId(body.studentId)
                ? await Lead.findOne({ _id: body.studentId, businessId: req.user.businessId, isArchived: { $ne: true } })
                : null;
            const existing = lead
                ? await AdmissionApplication.find({ businessId: req.user.businessId, studentId: lead._id }).select('counsellorId')
                : [];
            if (!lead || !isStudentInScope(lead, existing, await getScopedCounsellorIds(req))) {
                return fail(res, 404, 'Student not found');
            }
        } else {
            const student = validateStudentInput(body.student);
            if (student.error) return fail(res, 400, student.error);

            if (body.confirmDuplicate !== true) {
                const matches = await findDuplicateStudents(req, student.value);
                if (matches.length) {
                    return fail(res, 409, 'A student with the same email or phone already exists', {
                        code: 'POSSIBLE_DUPLICATE',
                        data: { matches },
                    });
                }
            }

            lead = await Lead.create({
                businessId: req.user.businessId,
                customerName: student.value.name,
                email: student.value.email,
                phone: student.value.phone,
                whatsapp: student.value.whatsapp,
                city: student.value.city,
                source: mapLeadSource(admission.value.leadSource),
                interestedIn: `${admission.value.studyLevel === 'MASTER' ? "Master's" : "Bachelor's"} in Czech Republic`,
                assignedTo: counsellor.counsellorId,
                createdBy: req.user.userId,
            });
            createdLeadId = lead._id;
        }

        const shortlist = [];
        for (const choice of Array.isArray(body.shortlist) ? body.shortlist.slice(0, 20) : []) {
            const resolved = await resolveChoice(req.user.businessId, choice);
            if (resolved?.error) return fail(res, 400, resolved.error);
            if (resolved?.universityName) shortlist.push(resolved);
        }

        const firstStage = getActiveStages(config)[0];
        const now = new Date();

        const application = await AdmissionApplication.create({
            businessId: req.user.businessId,
            studentId: lead._id,
            student: snapshotFromLead(lead),
            counsellorId: counsellor.counsellorId,
            createdBy: req.user.userId,
            ...admission.value,
            shortlist,
            currentStageKey: firstStage.key,
            stageEnteredAt: now,
            stageHistory: [
                {
                    stageKey: firstStage.key,
                    stageName: firstStage.name,
                    enteredAt: now,
                    enteredBy: req.user.userId,
                    direction: 'INITIAL',
                },
            ],
            checklist: buildChecklist(config),
        });
        createdLeadId = null;

        // Keep lead status in sync with admissions
        await Lead.updateOne({ _id: lead._id }, { $set: { status: 'ADMISSIONS' } }).catch(() => {});

        await logActivity({
            req,
            application,
            type: 'APPLICATION_CREATED',
            message: `Application created: ${application.studyLevel === 'MASTER' ? "Master's" : "Bachelor's"}, intake ${application.intakeMonth}/${application.intakeYear}`,
        });
        await raiseFees({ req, application, config, event: { type: 'STAGES_ENTERED', stageKeys: [firstStage.key] }, now });

        const saved = await loadForResponse(application._id);
        return res.status(201).json({
            success: true,
            message: 'Student added',
            data: serializeApplication(saved, config),
        });
    } catch (error) {
        if (createdLeadId) await Lead.deleteOne({ _id: createdLeadId }).catch(() => {});
        next(error);
    }
};

const listApplications = async (req, res, next) => {
    try {
        const config = req.admissionsConfig;
        const { filter, sort } = await buildApplicationQuery(req, req.query, config);

        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 500);
        const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);

        const [items, total] = await Promise.all([
            AdmissionApplication.find(filter)
                .select('-checklist.history -stageHistory')
                .sort(sort)
                .skip((page - 1) * limit)
                .limit(limit)
                .populate('counsellorId', COUNSELLOR_FIELDS),
            AdmissionApplication.countDocuments(filter),
        ]);

        const now = new Date();
        return res.json({
            success: true,
            data: { items: items.map((a) => serializeApplication(a, config, now)), total, page, limit },
        });
    } catch (error) {
        next(error);
    }
};

const getApplication = async (req, res, next) => {
    try {
        const config = req.admissionsConfig;
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        if (syncChecklist(application, config)) await application.save();

        await application.populate([
            { path: 'counsellorId', select: COUNSELLOR_FIELDS },
            { path: 'checklist.completedBy', select: 'name email role' },
        ]);

        const scope = await getApplicationScope(req);
        const others = await AdmissionApplication.find({
            ...scope,
            studentId: application.studentId,
            _id: { $ne: application._id },
        })
            .select('-checklist.history -stageHistory')
            .populate('counsellorId', COUNSELLOR_FIELDS)
            .sort({ createdAt: -1 });

        return res.json({
            success: true,
            data: {
                ...serializeApplicationDetail(application, config),
                otherApplications: others.map((a) => serializeApplication(a, config)),
            },
        });
    } catch (error) {
        next(error);
    }
};

/** Applies assessment edits; returns an error message or null. Sets needsReview on failures. */
const applyAssessment = (application, input) => {
    const assessment = application.assessment;

    for (const field of ['interviewRequired', 'examRequired']) {
        if (input[field] === undefined) continue;
        if (input[field] !== null && typeof input[field] !== 'boolean') return 'Requirement must be yes, no or not yet known';
        assessment[field] = input[field];
    }

    for (const field of ['interviewAt', 'examAt']) {
        if (input[field] === undefined) continue;
        const parsed = parseOptionalDate(input[field]);
        if (parsed.error) return parsed.error;
        assessment[field] = parsed.value;
    }

    for (const field of ['interviewResult', 'examResult']) {
        if (input[field] === undefined) continue;
        if (!ASSESSMENT_RESULTS.includes(input[field])) return 'Result must be pending, passed or failed';
        assessment[field] = input[field];
    }

    if (input.notes !== undefined) {
        if (typeof input.notes !== 'string') return 'Notes must be text';
        assessment.notes = input.notes.trim().slice(0, 2000);
    }

    const interviewFailed = assessment.interviewRequired === true && assessment.interviewResult === 'FAILED';
    const examFailed = assessment.examRequired === true && assessment.examResult === 'FAILED';

    if (interviewFailed || examFailed) {
        application.needsReview = true;
        application.reviewReason =
            interviewFailed && examFailed
                ? 'Interview and entrance exam failed'
                : interviewFailed
                  ? 'Interview failed'
                  : 'Entrance exam failed';
    } else if (application.needsReview && ASSESSMENT_REVIEW_REASONS.includes(application.reviewReason)) {
        application.needsReview = false;
        application.reviewReason = '';
    }

    return null;
};

const updateApplication = async (req, res, next) => {
    try {
        const body = req.body || {};
        const config = req.admissionsConfig;
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        // Fee conditions read these; fees whose condition becomes true are added after saving
        const before = {
            studyLevel: application.studyLevel,
            assessment: {
                interviewRequired: application.assessment?.interviewRequired ?? null,
                examRequired: application.assessment?.examRequired ?? null,
            },
        };
        const changes = [];

        if (body.student !== undefined) {
            const current = application.toObject().student;
            const student = validateStudentInput({ ...current, ...body.student });
            if (student.error) return fail(res, 400, student.error);

            const duplicates =
                body.confirmDuplicate === true
                    ? []
                    : await findDuplicateStudents(req, { ...student.value, excludeStudentId: application.studentId });
            if (duplicates.length) {
                return fail(res, 409, 'Another student has the same email or phone', {
                    code: 'POSSIBLE_DUPLICATE',
                    data: { matches: duplicates },
                });
            }

            // Lead hooks refresh every application's snapshot for this student
            const lead = await Lead.findOneAndUpdate(
                { _id: application.studentId, businessId: req.user.businessId },
                {
                    $set: {
                        customerName: student.value.name,
                        email: student.value.email,
                        phone: student.value.phone,
                        whatsapp: student.value.whatsapp,
                        city: student.value.city,
                    },
                },
                { new: true }
            );
            if (lead) application.student = snapshotFromLead(lead);
            changes.push('student details');
        }

        const admission = validateAdmissionInput(body, config, { partial: true });
        if (admission.error) return fail(res, 400, admission.error);
        if (Object.keys(admission.value).length) {
            Object.assign(application, admission.value);
            changes.push('admission details');
        }

        if (body.shortlist !== undefined) {
            if (!Array.isArray(body.shortlist)) return fail(res, 400, 'Shortlist must be a list');
            const shortlist = [];
            for (const choice of body.shortlist.slice(0, 20)) {
                const resolved = await resolveChoice(req.user.businessId, choice);
                if (resolved?.error) return fail(res, 400, resolved.error);
                if (resolved?.universityName) shortlist.push(resolved);
            }
            application.shortlist = shortlist;
            changes.push('shortlist');
        }

        if (body.finalChoice !== undefined) {
            const resolved = await resolveChoice(req.user.businessId, body.finalChoice);
            if (resolved?.error) return fail(res, 400, resolved.error);
            application.finalChoice = resolved || {};
            changes.push('final choice');
        }

        if (body.assessment !== undefined) {
            if (!body.assessment || typeof body.assessment !== 'object') return fail(res, 400, 'Invalid assessment details');
            const error = applyAssessment(application, body.assessment);
            if (error) return fail(res, 400, error);
            changes.push('interview / exam');
        }

        if (body.visa !== undefined) {
            if (!body.visa || typeof body.visa !== 'object') return fail(res, 400, 'Invalid visa details');
            if (body.visa.outcome !== undefined) return fail(res, 400, 'Record the visa result with the visa outcome action');
            if (body.visa.appointmentAt !== undefined) {
                const parsed = parseOptionalDate(body.visa.appointmentAt);
                if (parsed.error) return fail(res, 400, parsed.error);
                application.visa.appointmentAt = parsed.value;
            }
            if (body.visa.notes !== undefined) {
                if (typeof body.visa.notes !== 'string') return fail(res, 400, 'Notes must be text');
                application.visa.notes = body.visa.notes.trim().slice(0, 2000);
            }
            changes.push('visa appointment');
        }

        if (!changes.length) return fail(res, 400, 'Nothing to update');

        await application.save();
        await raiseFees({ req, application, config, event: { type: 'CONDITIONS_CHANGED', before } });
        await reminders.syncRemindersForApplication(application._id);

        const type = body.assessment !== undefined && changes.length === 1
            ? 'ASSESSMENT_UPDATED'
            : body.visa !== undefined && changes.length === 1
              ? 'VISA_UPDATED'
              : 'DETAILS_UPDATED';
        await logActivity({ req, application, type, message: `Updated ${changes.join(', ')}` });

        return getApplication(req, res, next);
    } catch (error) {
        next(error);
    }
};

const assignApplication = async (req, res, next) => {
    try {
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const result = await validateCounsellor(req, req.body?.counsellorId ?? null);
        if (result.error) return fail(res, result.status, result.error);

        const previousId = application.counsellorId;
        application.counsellorId = result.counsellorId;
        await application.save();

        // Keep the student's lead with the same owner so the Leads screen agrees,
        // and hand the previous counsellor's open tasks to the new one
        await Lead.updateOne({ _id: application.studentId }, { $set: { assignedTo: result.counsellorId } });
        if (previousId && result.counsellorId) {
            await FollowUp.updateMany(
                { applicationId: application._id, status: 'PENDING', assignedTo: previousId },
                { $set: { assignedTo: result.counsellorId } }
            );
        }
        await reminders.syncRemindersForApplication(application._id);

        const people = await User.find({ _id: { $in: [previousId, result.counsellorId].filter(Boolean) } }).select('name');
        const nameOf = (id) => people.find((p) => String(p._id) === String(id))?.name || 'Unassigned';
        await logActivity({
            req,
            application,
            type: 'ASSIGNED',
            message: `Counsellor changed from ${previousId ? nameOf(previousId) : 'Unassigned'} to ${nameOf(result.counsellorId)}`,
            meta: { from: previousId, to: result.counsellorId },
        });

        const saved = await loadForResponse(application._id);
        return res.json({ success: true, message: 'Counsellor updated', data: serializeApplication(saved, req.admissionsConfig) });
    } catch (error) {
        next(error);
    }
};

const updateApplicationStatus = async (req, res, next) => {
    try {
        const { status, reason } = req.body || {};
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const trimmed = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';

        if (status === 'WITHDRAWN') {
            if (application.status === 'WITHDRAWN') return fail(res, 409, 'Application is already withdrawn');
            if (trimmed.length < 3) return fail(res, 400, 'Give a reason for withdrawing the application');
            application.status = 'WITHDRAWN';
            application.withdrawnReason = trimmed;
            application.closedAt = new Date();
        } else if (status === 'CLOSED') {
            if (application.status === 'CLOSED') return fail(res, 409, 'Application is already closed');
            application.status = 'CLOSED';
            application.withdrawnReason = trimmed || 'Application closed';
            application.closedAt = new Date();
        } else if (status === 'ACTIVE') {
            if (application.status === 'ACTIVE') return fail(res, 409, 'Application is already active');
            application.status = 'ACTIVE';
            application.withdrawnReason = '';
            application.closedAt = null;
        } else {
            return fail(res, 400, 'Status must be ACTIVE, CLOSED, or WITHDRAWN');
        }

        await application.save();
        await reminders.syncRemindersForApplication(application._id);
        await logActivity({
            req,
            application,
            type: 'STATUS_CHANGED',
            message:
                status === 'WITHDRAWN'
                    ? `Application withdrawn: ${trimmed}`
                    : status === 'CLOSED'
                      ? `Application closed: ${trimmed || 'Closed'}`
                      : 'Application reactivated',
        });

        const saved = await loadForResponse(application._id);
        return res.json({ success: true, data: serializeApplication(saved, req.admissionsConfig) });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    checkDuplicates,
    createApplication,
    listApplications,
    getApplication,
    updateApplication,
    assignApplication,
    updateApplicationStatus,
    loadForResponse,
    COUNSELLOR_FIELDS,
};
