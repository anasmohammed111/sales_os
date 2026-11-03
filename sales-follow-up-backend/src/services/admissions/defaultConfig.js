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

const PAYMENT_CATEGORIES = ['AGENCY_FEE', 'UNIVERSITY_FEE', 'NOSTRIFICATION_FEE'];

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
            paymentCategory: 'NOSTRIFICATION_FEE',
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
    DEFAULT_STAGES,
    DEFAULT_DOCUMENT_TYPES,
    DEFAULT_LEAD_SOURCES,
    DEFAULT_REMINDERS,
    DEFAULT_TIMEZONE,
};
