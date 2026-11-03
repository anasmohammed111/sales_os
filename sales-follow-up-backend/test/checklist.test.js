const { test } = require('node:test');
const assert = require('node:assert');

const { buildDefaultConfig } = require('../src/services/admissions/configService');
const {
    buildChecklist,
    syncChecklist,
    isApplicable,
    checkRule,
    evaluateStage,
    setItemStatus,
} = require('../src/services/admissions/checklist');

const USER = 'user-1';

const makeConfig = () => JSON.parse(JSON.stringify(buildDefaultConfig('biz')));

const makeApp = (config, overrides = {}) => ({
    currentStageKey: 'lead_counselling',
    checklist: buildChecklist(config),
    assessment: {
        interviewRequired: null,
        examRequired: null,
        interviewAt: null,
        examAt: null,
        interviewResult: 'PENDING',
        examResult: 'PENDING',
    },
    visa: { appointmentAt: null, outcome: 'PENDING' },
    finalChoice: { universityName: '', courseName: '' },
    ...overrides,
});

const complete = (app, ...keys) => {
    for (const key of keys) {
        const result = setItemStatus(app, key, { status: 'COMPLETED', userId: USER });
        assert.ok(result.ok, `${key}: ${result.message}`);
    }
};

const entry = (app, key) => app.checklist.find((e) => e.itemKey === key);

test('buildChecklist snapshots every configured item as pending', () => {
    const config = makeConfig();
    const checklist = buildChecklist(config);

    assert.strictEqual(checklist.length, 39);
    assert.ok(checklist.every((e) => e.status === 'PENDING' && e.history.length === 0));
    assert.strictEqual(entry({ checklist }, 'enquiry_received').label, 'Enquiry received');
});

test('a stage with pending required items lists exactly what is missing', () => {
    const config = makeConfig();
    const app = makeApp(config);

    const result = evaluateStage(app, 'lead_counselling', config);

    assert.strictEqual(result.satisfied, false);
    assert.deepStrictEqual(
        result.missing.map((m) => m.label),
        ['Enquiry received', 'Counselling completed', 'Course, budget and intake discussed']
    );
});

test('completed and not-applicable items both satisfy a stage', () => {
    const config = makeConfig();
    const app = makeApp(config);

    complete(app, 'enquiry_received', 'counselling_completed');
    const na = setItemStatus(app, 'course_budget_intake_discussed', {
        status: 'NOT_APPLICABLE',
        reason: 'Discussed by partner agency',
        userId: USER,
    });

    assert.ok(na.ok);
    assert.strictEqual(evaluateStage(app, 'lead_counselling', config).satisfied, true);
    assert.strictEqual(entry(app, 'enquiry_received').completedBy, USER);
    assert.ok(entry(app, 'enquiry_received').completedAt instanceof Date);
    assert.strictEqual(entry(app, 'course_budget_intake_discussed').history.at(-1).reason, 'Discussed by partner agency');
});

test('marking an item not applicable requires a reason', () => {
    const config = makeConfig();
    const app = makeApp(config);

    const result = setItemStatus(app, 'enquiry_received', { status: 'NOT_APPLICABLE', reason: ' ', userId: USER });

    assert.strictEqual(result.ok, false);
    assert.match(result.message, /reason/i);
    assert.strictEqual(entry(app, 'enquiry_received').status, 'PENDING');
});

test('interview and exam items do not apply when neither is required', () => {
    const config = makeConfig();
    const app = makeApp(config, { currentStageKey: 'university_application' });
    app.assessment.interviewRequired = false;
    app.assessment.examRequired = false;

    complete(app, 'application_submitted', 'assessment_requirements_recorded');

    assert.strictEqual(isApplicable(entry(app, 'exam_date_recorded'), app), false);
    assert.strictEqual(evaluateStage(app, 'university_application', config).satisfied, true);
});

test('requirement item cannot be completed until both requirements are recorded', () => {
    const config = makeConfig();
    const app = makeApp(config);
    app.assessment.examRequired = true;

    const result = setItemStatus(app, 'assessment_requirements_recorded', { status: 'COMPLETED', userId: USER });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.message, 'Record whether an interview and an entrance exam are required first');
});

test('a required exam adds its items and the date must exist before completion', () => {
    const config = makeConfig();
    const app = makeApp(config);
    app.assessment.interviewRequired = false;
    app.assessment.examRequired = true;
    complete(app, 'application_submitted', 'assessment_requirements_recorded');

    const missing = evaluateStage(app, 'university_application', config).missing.map((m) => m.itemKey);
    assert.deepStrictEqual(missing, ['exam_date_recorded', 'exam_preparation_completed', 'exam_result_recorded']);

    const blocked = setItemStatus(app, 'exam_date_recorded', { status: 'COMPLETED', userId: USER });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.message, 'Record the entrance exam date first');
    assert.strictEqual(checkRule(entry(app, 'exam_date_recorded'), app), 'Record the entrance exam date first');
});

test('a failed exam blocks the stage even when every item is complete', () => {
    const config = makeConfig();
    const app = makeApp(config);
    Object.assign(app.assessment, {
        interviewRequired: false,
        examRequired: true,
        examAt: new Date(),
        examResult: 'FAILED',
    });
    complete(
        app,
        'application_submitted',
        'assessment_requirements_recorded',
        'exam_date_recorded',
        'exam_preparation_completed',
        'exam_result_recorded'
    );

    const result = evaluateStage(app, 'university_application', config);

    assert.strictEqual(result.satisfied, false);
    assert.deepStrictEqual(result.missing, []);
    assert.strictEqual(result.gateError, 'The entrance exam was failed. The application is flagged for review.');
});

test('a completed item whose recorded data was later removed counts as missing', () => {
    const config = makeConfig();
    const app = makeApp(config);
    Object.assign(app.assessment, { interviewRequired: false, examRequired: true, examAt: new Date() });
    complete(app, 'exam_date_recorded');

    app.assessment.examAt = null;
    const missing = evaluateStage(app, 'university_application', config).missing;

    assert.ok(missing.some((m) => m.itemKey === 'exam_date_recorded' && m.reason === 'Record the entrance exam date first'));
});

test('new config items reach only stages the application has not passed', () => {
    const config = makeConfig();
    const app = makeApp(config, { currentStageKey: 'university_selection' });

    config.stages.find((s) => s.key === 'lead_counselling').items.push({ key: 'new_early', label: 'Early check', required: true });
    config.stages.find((s) => s.key === 'apostille').items.push({ key: 'new_later', label: 'Later check', required: true });

    assert.strictEqual(syncChecklist(app, config), true);
    assert.ok(!entry(app, 'new_early'));
    assert.strictEqual(entry(app, 'new_later').status, 'PENDING');
    assert.strictEqual(syncChecklist(app, config), false);
});

test('archiving a pending item retires it; completed items keep their recorded label', () => {
    const config = makeConfig();
    const app = makeApp(config);
    complete(app, 'enquiry_received');

    const stage = config.stages.find((s) => s.key === 'lead_counselling');
    stage.items.find((i) => i.key === 'enquiry_received').label = 'Enquiry logged';
    stage.items.find((i) => i.key === 'counselling_completed').label = 'Counselling session held';
    stage.items.find((i) => i.key === 'course_budget_intake_discussed').isArchived = true;

    syncChecklist(app, config);

    assert.strictEqual(entry(app, 'enquiry_received').label, 'Enquiry received');
    assert.strictEqual(entry(app, 'counselling_completed').label, 'Counselling session held');
    assert.strictEqual(entry(app, 'course_budget_intake_discussed').isRetired, true);

    complete(app, 'counselling_completed');
    assert.strictEqual(evaluateStage(app, 'lead_counselling', config).satisfied, true);
});

test('optional items never block a stage', () => {
    const config = makeConfig();
    const app = makeApp(config, { currentStageKey: 'pre_enrollment' });
    complete(app, 'university_confirmation_received', 'payment_reviewed');

    assert.strictEqual(evaluateStage(app, 'pre_enrollment', config).satisfied, true);
});

test('unknown item keys are rejected', () => {
    const config = makeConfig();
    const app = makeApp(config);

    const result = setItemStatus(app, 'does_not_exist', { status: 'COMPLETED', userId: USER });

    assert.deepStrictEqual(result, { ok: false, status: 404, message: 'Checklist item not found' });
});
