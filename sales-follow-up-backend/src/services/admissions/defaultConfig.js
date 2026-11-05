// Default SYB admissions configuration, seeded once per business.
// Keys are permanent identifiers: rename labels freely, never change keys.

const CONDITIONS = ['INTERVIEW_REQUIRED', 'EXAM_REQUIRED'];

// Rules name data that must exist before an item can be completed.
const RULES = [
    'FINAL_CHOICE_SET',
    'ASSESSMENT_REQUIREMENTS_SET',
    'INTERVIEW_DATE_SET',
    'INTERVIEW_RESULT_SET',
    'EXAM_DATE_SET',
    'EXAM_RESULT_SET',
    'VISA_APPOINTMENT_SET',
    'VISA_OUTCOME_SET',
];

const GATES = ['ASSESSMENT_PASSED'];

// SERVICE_FEE: the agency's own charge (income). STUDENT_EXPENSE: collected and
// paid on to someone else (apostille office, embassy, courier). UNIVERSITY_FEE:
// tuition and other money owed to the university.
const PAYMENT_CATEGORIES = ['SERVICE_FEE', 'STUDENT_EXPENSE', 'UNIVERSITY_FEE'];

// Older names, mapped by migration 003
const LEGACY_PAYMENT_CATEGORIES = { AGENCY_FEE: 'SERVICE_FEE', NOSTRIFICATION_FEE: 'STUDENT_EXPENSE' };

// When a fee from the fee list is added to a student:
// STAGE_ENTERED  the student reaches the fee's stage
// ITEM_COMPLETED a checklist item of that stage is ticked
// VISA_APPROVED  the visa result is recorded as approved
// MANUAL         never automatically; staff add it when it applies
const FEE_TRIGGERS = ['STAGE_ENTERED', 'ITEM_COMPLETED', 'VISA_APPROVED', 'MANUAL'];

// Fees can be limited to some students
const FEE_CONDITIONS = ['INTERVIEW_REQUIRED', 'EXAM_REQUIRED', 'INTERVIEW_OR_EXAM', 'BACHELOR', 'MASTER'];

// What waits for an unpaid fee:
// NONE  nothing, the fee is only tracked
// ITEM  a checklist item of the fee's stage cannot be ticked until it is paid
// STAGE the student cannot move past the fee's stage until it is paid
const FEE_HOLDS = ['NONE', 'ITEM', 'STAGE'];

const item = (key, label, { required = true, condition = null, rule = null, paymentCategory = null } = {}) => ({
    key,
    label,
    required,
    condition,
    rule,
    paymentCategory,
});

const stage = (key, name, items, { gate = null } = {}) => ({
    key,
    name,
    stuckThresholdDays: 7,
    gate,
    items,
});

const DEFAULT_STAGES = [
    stage('lead_counselling', 'Lead / Counselling', [
        item('enquiry_received', 'Enquiry received'),
        item('counselling_completed', 'Counselling completed'),
        item('course_budget_intake_discussed', 'Course, budget and intake discussed'),
    ]),
    stage('university_selection', 'University Selection', [
        item('shortlist_shared', 'University/course shortlist shared'),
        item('final_choice_confirmed', "Student's final choice confirmed", { rule: 'FINAL_CHOICE_SET' }),
    ]),
    stage('apostille', 'Apostille', [
        item('documents_sent_for_apostille', 'Documents sent for apostille'),
        item('apostille_completed', 'Apostille process completed'),
        item('apostille_documents_reviewed', 'Documents reviewed'),
        item('apostille_copy_received', 'Copy of apostilled documents received by email'),
    ]),
    stage(
        'university_application',
        'University Application',
        [
            item('application_submitted', 'Application submitted'),
            item('assessment_requirements_recorded', 'Interview or entrance exam requirement recorded', {
                rule: 'ASSESSMENT_REQUIREMENTS_SET',
            }),
            item('interview_date_recorded', 'Interview date recorded', {
                condition: 'INTERVIEW_REQUIRED',
                rule: 'INTERVIEW_DATE_SET',
            }),
            item('interview_preparation_completed', 'Interview preparation completed', {
                condition: 'INTERVIEW_REQUIRED',
            }),
            item('interview_result_recorded', 'Interview result recorded (passed or failed)', {
                condition: 'INTERVIEW_REQUIRED',
                rule: 'INTERVIEW_RESULT_SET',
            }),
            item('exam_date_recorded', 'Entrance exam date recorded', {
                condition: 'EXAM_REQUIRED',
                rule: 'EXAM_DATE_SET',
            }),
            item('exam_preparation_completed', 'Entrance exam preparation completed', {
                condition: 'EXAM_REQUIRED',
            }),
            item('exam_result_recorded', 'Entrance exam result recorded (passed or failed)', {
                condition: 'EXAM_REQUIRED',
                rule: 'EXAM_RESULT_SET',
            }),
        ],
        { gate: 'ASSESSMENT_PASSED' }
    ),
    stage('pre_enrollment', 'Pre-enrollment', [
        item('university_confirmation_received', 'University confirmation email received'),
        item('payment_reviewed', 'Payment reviewed'),
        item('pending_documents_reminder_sent', 'Pending documents reminder sent', { required: false }),
    ]),
    stage('nostrification', 'Nostrification', [
        item('documents_notarized', 'Documents notarized'),
        item('nostrification_form_completed', 'Nostrification form completed'),
        item('documents_couriered_cz', 'Documents couriered to the Czech Republic'),
        item('nostrification_payment_completed', 'Nostrification payment completed', {
            paymentCategory: 'STUDENT_EXPENSE',
        }),
        item('nostrification_confirmation_received', 'Confirmation received'),
    ]),
    stage('offer_letter', 'Offer Letter', [
        item('university_fee_paid', 'University fee paid', { paymentCategory: 'UNIVERSITY_FEE' }),
        item('nostrification_submitted', 'Nostrification submitted'),
        item('offer_accommodation_requested', 'Offer letter and accommodation letter requested by email'),
        item('offer_letter_received', 'Offer letter received by email'),
        item('accommodation_letter_received', 'Accommodation letter received by email'),
        item('original_offer_letter_posted', 'Original offer letter sent by post'),
        item('visa_documents_courier_received', 'Courier received for visa documents'),
    ]),
    stage('visa', 'Visa', [
        item('pcc_initiated', 'PCC application initiated'),
        item('visa_appointment_registered', 'Visa appointment registered'),
        item('visa_appointment_date_recorded', 'Visa appointment/interview date recorded', {
            rule: 'VISA_APPOINTMENT_SET',
        }),
        item('visa_interview_preparation_completed', 'Visa interview preparation completed'),
        item('visa_documents_ready', 'Visa documents ready'),
        item('visa_interview_completed', 'Visa interview completed'),
        item('visa_result_recorded', 'Visa result recorded (approved or rejected)', {
            rule: 'VISA_OUTCOME_SET',
        }),
    ]),
];

const fee = (key, name, category, rupees, stageKey, options = {}) => ({
    key,
    name,
    category,
    // null: the amount differs per student and is entered on the student's payments
    amountMinor: rupees === null ? null : rupees * 100,
    currency: options.currency ?? 'INR',
    stageKey,
    trigger: options.trigger ?? 'STAGE_ENTERED',
    triggerItemKey: options.triggerItemKey ?? null,
    condition: options.condition ?? null,
    dueInDays: options.dueInDays ?? 7,
    hold: options.hold ?? 'NONE',
    holdItemKey: options.holdItemKey ?? null,
    // Tick the held item by itself once the fee is fully paid
    autoCompleteItem: options.autoCompleteItem ?? false,
    // Counted when a refund rule applies (for example a rejected visa)
    refundable: options.refundable ?? category === 'SERVICE_FEE',
    isArchived: false,
});

// SYB's service charges and student expenses. Every entry can be edited,
// moved to another stage, archived or extended in admissions settings.
const DEFAULT_FEES = [
    fee('registration_fee', 'Registration fee', 'SERVICE_FEE', 5000, 'lead_counselling', { hold: 'STAGE' }),
    fee('apostille', 'Apostille', 'STUDENT_EXPENSE', 4000, 'apostille', {
        hold: 'ITEM',
        holdItemKey: 'documents_sent_for_apostille',
    }),
    fee('university_application_fee', 'University application fee', 'STUDENT_EXPENSE', null, 'university_application', {
        hold: 'ITEM',
        holdItemKey: 'application_submitted',
    }),
    fee('interview_exam_preparation', 'Interview / entrance exam preparation', 'SERVICE_FEE', 10000, 'university_application', {
        condition: 'INTERVIEW_OR_EXAM',
        hold: 'STAGE',
    }),
    fee('translation', 'Translation', 'STUDENT_EXPENSE', 10000, 'nostrification', {
        hold: 'ITEM',
        holdItemKey: 'documents_couriered_cz',
    }),
    fee('document_courier', 'Document courier service', 'STUDENT_EXPENSE', 10000, 'nostrification', {
        hold: 'ITEM',
        holdItemKey: 'documents_couriered_cz',
    }),
    fee('nostrification', 'Nostrification', 'STUDENT_EXPENSE', 15000, 'nostrification', {
        hold: 'ITEM',
        holdItemKey: 'nostrification_payment_completed',
        autoCompleteItem: true,
    }),
    fee('offer_letter', 'Offer letter', 'SERVICE_FEE', 25000, 'offer_letter', {
        trigger: 'ITEM_COMPLETED',
        triggerItemKey: 'offer_letter_received',
        hold: 'STAGE',
    }),
    fee('tuition', 'Tuition fee', 'UNIVERSITY_FEE', null, 'offer_letter', {
        hold: 'ITEM',
        holdItemKey: 'university_fee_paid',
        autoCompleteItem: true,
    }),
    fee('embassy_interview', 'Embassy interview', 'STUDENT_EXPENSE', 11000, 'visa', {
        trigger: 'ITEM_COMPLETED',
        triggerItemKey: 'visa_appointment_registered',
        hold: 'ITEM',
        holdItemKey: 'visa_documents_ready',
    }),
    fee('embassy_date', 'Embassy date', 'SERVICE_FEE', 30000, 'visa', {
        trigger: 'ITEM_COMPLETED',
        triggerItemKey: 'visa_appointment_registered',
        hold: 'ITEM',
        holdItemKey: 'visa_documents_ready',
    }),
    fee('visa_approval', 'Visa approval', 'SERVICE_FEE', 30000, 'visa', { trigger: 'VISA_APPROVED' }),
    fee('alternative_accommodation', 'Alternative accommodation contract', 'STUDENT_EXPENSE', 5000, 'offer_letter', {
        currency: 'CZK',
        trigger: 'MANUAL',
    }),
];

const DEFAULT_DOCUMENT_TYPES = [
    { key: 'passport', name: 'Passport', hasExpiry: true },
    { key: 'certificates', name: 'Certificates', hasExpiry: false },
    { key: 'transcripts', name: 'Transcripts', hasExpiry: false },
    { key: 'apostilled_documents', name: 'Apostilled documents', hasExpiry: false },
    { key: 'pcc', name: 'Police clearance certificate (PCC)', hasExpiry: true },
    { key: 'offer_letter', name: 'Offer letter', hasExpiry: false },
    { key: 'accommodation_letter', name: 'Accommodation letter', hasExpiry: false },
    { key: 'visa_documents', name: 'Visa documents', hasExpiry: true },
];

const DEFAULT_LEAD_SOURCES = [
    { key: 'instagram', name: 'Instagram' },
    { key: 'referral', name: 'Referral' },
    { key: 'website', name: 'Website' },
    { key: 'walk_in', name: 'Walk-in' },
    { key: 'whatsapp', name: 'WhatsApp' },
    { key: 'facebook', name: 'Facebook' },
    { key: 'other', name: 'Other' },
];

const DEFAULT_REMINDERS = {
    followUpMinutesBefore: 30,
    interviewDaysBefore: 2,
    examDaysBefore: 2,
    visaDaysBefore: 2,
    paymentDaysBefore: 3,
    documentExpiryDaysBefore: 30,
};

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

module.exports = {
    CONDITIONS,
    RULES,
    GATES,
    PAYMENT_CATEGORIES,
    LEGACY_PAYMENT_CATEGORIES,
    FEE_TRIGGERS,
    FEE_CONDITIONS,
    FEE_HOLDS,
    DEFAULT_STAGES,
    DEFAULT_FEES,
    DEFAULT_DOCUMENT_TYPES,
    DEFAULT_LEAD_SOURCES,
    DEFAULT_REMINDERS,
    DEFAULT_TIMEZONE,
};
