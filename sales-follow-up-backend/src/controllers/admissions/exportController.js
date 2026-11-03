const AdmissionApplication = require('../../models/AdmissionApplication');
const { findStage } = require('../../services/admissions/configService');
const { buildApplicationQuery } = require('../../services/admissions/filters');
const { serializeApplication } = require('../../services/admissions/serialize');
const { formatMinor } = require('../../services/admissions/money');
const { formatDate, formatDateTime } = require('../../services/admissions/time');
const { sendExport } = require('../../services/admissions/exporter');
const { CATEGORY_NAMES, queryPaymentRows, serializePaymentRow } = require('./paymentController');

const MAX_ROWS = 10000;

const LEVELS = { BACHELOR: "Bachelor's", MASTER: "Master's" };
const yesNo = (v) => (v ? 'Yes' : 'No');
const title = (value) => (value ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ') : '');
const intakeOf = (a) => `${String(a.intakeMonth).padStart(2, '0')}/${a.intakeYear}`;

const APPLICATION_COLUMNS = [
    { key: 'name', header: 'Student', width: 26 },
    { key: 'phone', header: 'Phone' },
    { key: 'email', header: 'Email', width: 28 },
    { key: 'whatsapp', header: 'WhatsApp' },
    { key: 'city', header: 'City' },
    { key: 'level', header: 'Level' },
    { key: 'intake', header: 'Intake', width: 10 },
    { key: 'source', header: 'Lead source' },
    { key: 'counsellor', header: 'Counsellor', width: 22 },
    { key: 'stage', header: 'Stage', width: 22 },
    { key: 'daysInStage', header: 'Days in stage', width: 12 },
    { key: 'stuck', header: 'Stuck', width: 8 },
    { key: 'nextFollowUp', header: 'Next follow-up', width: 22 },
    { key: 'university', header: 'Final university', width: 26 },
    { key: 'course', header: 'Final course', width: 26 },
    { key: 'interview', header: 'Interview result' },
    { key: 'exam', header: 'Exam result' },
    { key: 'visaAppointment', header: 'Visa appointment', width: 22 },
    { key: 'visaOutcome', header: 'Visa outcome' },
    { key: 'status', header: 'Status' },
    { key: 'paymentStatus', header: 'Payment status' },
    { key: 'outstanding', header: 'Outstanding', width: 26 },
    { key: 'created', header: 'Added on', width: 14 },
];

/** GET /applications/export — the Students list with the same filters and scope, no file contents. */
const exportApplications = async (req, res, next) => {
    try {
        const config = req.admissionsConfig;
        const tz = config.timezone;
        const now = new Date();
        const { filter, sort } = await buildApplicationQuery(req, req.query, config, now);

        const applications = await AdmissionApplication.find(filter)
            .select('-checklist.history -stageHistory')
            .sort(sort)
            .limit(MAX_ROWS)
            .populate('counsellorId', 'name email role isActive');

        const sources = new Map(config.leadSources.map((s) => [s.key, s.name]));
        const rows = applications.map((application) => {
            const a = serializeApplication(application, config, now);
            const assessment = a.assessment || {};
            return {
                name: a.student.name,
                phone: a.student.phone,
                email: a.student.email,
                whatsapp: a.student.whatsapp,
                city: a.student.city,
                level: LEVELS[a.studyLevel],
                intake: intakeOf(a),
                source: sources.get(a.leadSource) || a.leadSource,
                counsellor: a.counsellor?.name || 'Unassigned',
                stage: findStage(config, a.currentStage.key)?.name || a.currentStage.key,
                daysInStage: a.daysInStage,
                stuck: yesNo(a.isStuck),
                nextFollowUp: formatDateTime(a.nextFollowUpAt, tz),
                university: a.finalChoice?.universityName || '',
                course: a.finalChoice?.courseName || '',
                interview: assessment.interviewRequired === true ? title(assessment.interviewResult) : assessment.interviewRequired === false ? 'Not required' : '',
                exam: assessment.examRequired === true ? title(assessment.examResult) : assessment.examRequired === false ? 'Not required' : '',
                visaAppointment: formatDateTime(a.visa?.appointmentAt, tz),
                visaOutcome: title(a.visa?.outcome),
                status: title(a.status),
                paymentStatus: title(a.paymentSummary?.status),
                outstanding: (a.paymentSummary?.byCurrency || [])
                    .filter((r) => r.outstandingMinor > 0)
                    .map((r) => `${r.currency} ${formatMinor(r.outstandingMinor)}`)
                    .join('; '),
                created: formatDate(a.createdAt, tz),
            };
        });

        return sendExport(res, {
            format: req.query.format,
            basename: 'admissions-students',
            sheetName: 'Students',
            columns: APPLICATION_COLUMNS,
            rows,
        });
    } catch (error) {
        next(error);
    }
};

const PAYMENT_COLUMNS = [
    { key: 'student', header: 'Student', width: 26 },
    { key: 'phone', header: 'Phone' },
    { key: 'counsellor', header: 'Counsellor', width: 22 },
    { key: 'intake', header: 'Intake', width: 10 },
    { key: 'category', header: 'Category', width: 20 },
    { key: 'label', header: 'Description', width: 24 },
    { key: 'currency', header: 'Currency', width: 10 },
    { key: 'due', header: 'Amount due', width: 14 },
    { key: 'paid', header: 'Paid', width: 14 },
    { key: 'outstanding', header: 'Outstanding', width: 14 },
    { key: 'status', header: 'Status', width: 16 },
    { key: 'dueDate', header: 'Due date', width: 14 },
    { key: 'overdue', header: 'Overdue', width: 10 },
];

/** GET /payments/export — the payment tracker rows with the same filters and scope. */
const exportPayments = async (req, res, next) => {
    try {
        const tz = req.admissionsConfig.timezone;
        const now = new Date();
        const { fees, applicationsById } = await queryPaymentRows(req, req.query, now);

        const rows = fees.slice(0, MAX_ROWS).map((fee) => {
            const row = serializePaymentRow(fee, applicationsById.get(String(fee.applicationId)), now);
            return {
                student: row.student?.name || '',
                phone: row.student?.phone || '',
                counsellor: row.counsellor?.name || 'Unassigned',
                intake: row.intakeMonth ? `${String(row.intakeMonth).padStart(2, '0')}/${row.intakeYear}` : '',
                category: CATEGORY_NAMES[row.category],
                label: row.label,
                currency: row.currency,
                due: Number(row.amountDue),
                paid: Number(row.paid),
                outstanding: Number(row.outstanding),
                status: title(row.status),
                dueDate: formatDate(row.dueDate, tz),
                overdue: yesNo(row.isOverdue),
            };
        });

        return sendExport(res, {
            format: req.query.format,
            basename: 'admissions-payments',
            sheetName: 'Payments',
            columns: PAYMENT_COLUMNS,
            rows,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { exportApplications, exportPayments };
