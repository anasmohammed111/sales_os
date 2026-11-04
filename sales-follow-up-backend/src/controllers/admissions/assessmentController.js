const AdmissionApplication = require('../../models/AdmissionApplication');
const { getApplicationScope } = require('../../services/admissions/access');
const { findStage } = require('../../services/admissions/configService');
const { DAY_MS } = require('../../services/admissions/filters');

// Past interviews/exams stay on the "awaiting result" list for this long
const RESULT_WINDOW_DAYS = 30;
const MAX_APPLICATIONS = 1000;

/** One interview or exam per application per kind, when a date is set. */
const assessmentEvents = (application, stage) => {
    const base = {
        applicationId: application._id,
        studentId: application.studentId,
        student: { name: application.student?.name ?? '', phone: application.student?.phone ?? '' },
        counsellor: application.counsellorId?.name ?? null,
        currentStage: stage
            ? { key: stage.key, name: stage.name }
            : { key: application.currentStageKey, name: application.currentStageKey },
    };

    const events = [];
    const { assessment } = application;

    if (assessment?.interviewAt && assessment.interviewRequired !== false) {
        events.push({ ...base, type: 'INTERVIEW', at: assessment.interviewAt, result: assessment.interviewResult });
    }
    if (assessment?.examAt && assessment.examRequired !== false) {
        events.push({ ...base, type: 'EXAM', at: assessment.examAt, result: assessment.examResult });
    }
    return events;
};

/**
 * Interviews and entrance exams for the user's visible active applications.
 * `upcoming` runs from now onwards, earliest first. `awaitingResult` holds
 * recent past ones still marked PENDING, most recent first.
 */
const listAssessments = async (req, res, next) => {
    try {
        const config = req.admissionsConfig;
        const now = new Date();
        const since = new Date(now.getTime() - RESULT_WINDOW_DAYS * DAY_MS);
        const scope = await getApplicationScope(req);

        const applications = await AdmissionApplication.find({
            ...scope,
            status: 'ACTIVE',
            $or: [{ 'assessment.interviewAt': { $gte: since } }, { 'assessment.examAt': { $gte: since } }],
        })
            .select('studentId student counsellorId currentStageKey assessment')
            .populate('counsellorId', 'name')
            .limit(MAX_APPLICATIONS);

        const events = applications.flatMap((application) =>
            assessmentEvents(application, findStage(config, application.currentStageKey))
        );

        const upcoming = events
            .filter((e) => new Date(e.at) >= now)
            .sort((a, b) => new Date(a.at) - new Date(b.at));

        const awaitingResult = events
            .filter((e) => new Date(e.at) < now && new Date(e.at) >= since && e.result === 'PENDING')
            .sort((a, b) => new Date(b.at) - new Date(a.at));

        return res.json({
            success: true,
            data: { upcoming, awaitingResult, timezone: config.timezone },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { listAssessments };
