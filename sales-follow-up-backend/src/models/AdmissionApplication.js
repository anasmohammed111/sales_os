const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const ITEM_STATUSES = ['PENDING', 'COMPLETED', 'NOT_APPLICABLE'];
const ASSESSMENT_RESULTS = ['PENDING', 'PASSED', 'FAILED'];
const VISA_OUTCOMES = ['PENDING', 'APPROVED', 'REJECTED'];
const APPLICATION_STATUSES = ['ACTIVE', 'CLOSED', 'WITHDRAWN'];
const STUDY_LEVELS = ['BACHELOR', 'MASTER'];
const PAYMENT_STATUSES = ['NONE', 'UNPAID', 'PARTIALLY_PAID', 'PAID'];

// One checklist entry per configured item, snapshotted onto the application
// so later template changes never rewrite recorded history.
const checklistEntrySchema = new mongoose.Schema({
    stageKey: { type: String, required: true },
    itemKey: { type: String, required: true },
    label: { type: String, required: true },
    required: { type: Boolean, default: true },
    condition: { type: String, default: null },
    rule: { type: String, default: null },
    paymentCategory: { type: String, default: null },
    // Archived in the configuration while still pending: no longer required
    isRetired: { type: Boolean, default: false },

    status: { type: String, enum: ITEM_STATUSES, default: 'PENDING' },
    naReason: { type: String, trim: true, default: '' },
    completedBy: { type: ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
    updatedAt: { type: Date, default: null },
    history: [
        {
            _id: false,
            status: { type: String, enum: ITEM_STATUSES },
            reason: { type: String, default: '' },
            by: { type: ObjectId, ref: 'User' },
            at: { type: Date, default: Date.now },
        },
    ],
});

const stageVisitSchema = new mongoose.Schema(
    {
        stageKey: { type: String, required: true },
        stageName: { type: String, default: '' },
        enteredAt: { type: Date, required: true },
        exitedAt: { type: Date, default: null },
        enteredBy: { type: ObjectId, ref: 'User', default: null },
        direction: { type: String, enum: ['INITIAL', 'FORWARD', 'BACKWARD'], default: 'FORWARD' },
        override: { type: Boolean, default: false },
        reason: { type: String, trim: true, default: '' },
        // Requirements that were still missing when an override was used
        overriddenItems: [{ type: String }],
    },
    { _id: false }
);

const universityChoiceSchema = new mongoose.Schema(
    {
        universityId: { type: ObjectId, ref: 'University', default: null },
        courseId: { type: ObjectId, default: null },
        universityName: { type: String, trim: true, default: '' },
        courseName: { type: String, trim: true, default: '' },
    },
    { _id: false }
);

const admissionApplicationSchema = new mongoose.Schema(
    {
        businessId: { type: ObjectId, ref: 'Business', required: true },

        // The student is a Lead; this snapshot powers search and is kept in sync by Lead hooks
        studentId: { type: ObjectId, ref: 'Lead', required: true },
        student: {
            name: { type: String, default: '' },
            email: { type: String, default: '' },
            phone: { type: String, default: '' },
            phoneDigits: { type: String, default: '' },
            whatsapp: { type: String, default: '' },
            city: { type: String, default: '' },
        },

        counsellorId: { type: ObjectId, ref: 'User', default: null },
        createdBy: { type: ObjectId, ref: 'User', required: true },

        studyLevel: { type: String, enum: STUDY_LEVELS, required: true },
        intakeMonth: { type: Number, min: 1, max: 12, required: true },
        intakeYear: { type: Number, min: 2000, max: 2100, required: true },
        leadSource: { type: String, default: 'other' },

        shortlist: [universityChoiceSchema],
        finalChoice: { type: universityChoiceSchema, default: () => ({}) },

        currentStageKey: { type: String, required: true },
        stageEnteredAt: { type: Date, required: true },
        stageHistory: [stageVisitSchema],

        checklist: [checklistEntrySchema],

        assessment: {
            // null = not yet recorded
            interviewRequired: { type: Boolean, default: null },
            examRequired: { type: Boolean, default: null },
            interviewAt: { type: Date, default: null },
            examAt: { type: Date, default: null },
            interviewResult: { type: String, enum: ASSESSMENT_RESULTS, default: 'PENDING' },
            examResult: { type: String, enum: ASSESSMENT_RESULTS, default: 'PENDING' },
            notes: { type: String, trim: true, default: '', maxlength: 2000 },
        },

        visa: {
            appointmentAt: { type: Date, default: null },
            outcome: { type: String, enum: VISA_OUTCOMES, default: 'PENDING' },
            outcomeAt: { type: Date, default: null },
            outcomeBy: { type: ObjectId, ref: 'User', default: null },
            notes: { type: String, trim: true, default: '', maxlength: 2000 },
        },

        status: { type: String, enum: APPLICATION_STATUSES, default: 'ACTIVE' },
        closedAt: { type: Date, default: null },
        withdrawnReason: { type: String, trim: true, default: '' },

        needsReview: { type: Boolean, default: false },
        reviewReason: { type: String, default: '' },

        // Earliest pending task for this application
        nextFollowUpAt: { type: Date, default: null },

        // Maintained from AdmissionFee records; totals never mix currencies
        paymentSummary: {
            status: { type: String, enum: PAYMENT_STATUSES, default: 'NONE' },
            nextDueAt: { type: Date, default: null },
            byCurrency: [
                {
                    _id: false,
                    currency: String,
                    dueMinor: Number,
                    paidMinor: Number,
                    outstandingMinor: Number,
                },
            ],
        },
    },
    { timestamps: true }
);

admissionApplicationSchema.index({ businessId: 1, status: 1, currentStageKey: 1 });
admissionApplicationSchema.index({ businessId: 1, counsellorId: 1, status: 1 });
admissionApplicationSchema.index({ businessId: 1, studentId: 1 });
admissionApplicationSchema.index({ businessId: 1, intakeYear: 1, intakeMonth: 1 });
admissionApplicationSchema.index({ businessId: 1, nextFollowUpAt: 1 });
admissionApplicationSchema.index({ businessId: 1, createdAt: -1 });

module.exports = mongoose.model('AdmissionApplication', admissionApplicationSchema);
module.exports.ITEM_STATUSES = ITEM_STATUSES;
module.exports.ASSESSMENT_RESULTS = ASSESSMENT_RESULTS;
module.exports.VISA_OUTCOMES = VISA_OUTCOMES;
module.exports.APPLICATION_STATUSES = APPLICATION_STATUSES;
module.exports.STUDY_LEVELS = STUDY_LEVELS;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
