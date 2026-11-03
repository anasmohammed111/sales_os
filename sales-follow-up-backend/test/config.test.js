const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');

const { DEFAULT_STAGES } = require('../src/services/admissions/defaultConfig');
const { ensureConfig, getActiveStages } = require('../src/services/admissions/configService');
const { normalizePhone } = require('../src/services/admissions/phone');
const { parseMoney, formatMinor } = require('../src/services/admissions/money');
const { runMigrations } = require('../src/migrations');
const AdmissionConfig = require('../src/models/AdmissionConfig');
const Lead = require('../src/models/Leads');
const Business = require('../src/models/Business');

before(h.startDb);
after(h.stopDb);
beforeEach(h.resetDb);

test('default pipeline seeds the eight stages in the specified order', () => {
    assert.deepStrictEqual(
        DEFAULT_STAGES.map((s) => s.key),
        [
            'lead_counselling',
            'university_selection',
            'apostille',
            'university_application',
            'pre_enrollment',
            'nostrification',
            'offer_letter',
            'visa',
        ]
    );
    assert.deepStrictEqual(
        DEFAULT_STAGES.map((s) => s.items.length),
        [3, 2, 4, 8, 3, 5, 7, 7]
    );
});

test('university application stage has separate conditional interview and exam items and a pass gate', () => {
    const stage = DEFAULT_STAGES.find((s) => s.key === 'university_application');
    const byKey = Object.fromEntries(stage.items.map((i) => [i.key, i]));

    assert.strictEqual(stage.gate, 'ASSESSMENT_PASSED');
    assert.strictEqual(byKey.assessment_requirements_recorded.rule, 'ASSESSMENT_REQUIREMENTS_SET');
    assert.strictEqual(byKey.interview_date_recorded.condition, 'INTERVIEW_REQUIRED');
    assert.strictEqual(byKey.interview_result_recorded.rule, 'INTERVIEW_RESULT_SET');
    assert.strictEqual(byKey.exam_date_recorded.condition, 'EXAM_REQUIRED');
    assert.strictEqual(byKey.exam_date_recorded.rule, 'EXAM_DATE_SET');
    assert.strictEqual(byKey.exam_result_recorded.rule, 'EXAM_RESULT_SET');
});

test('pending documents reminder is optional and visa result needs an outcome', () => {
    const pre = DEFAULT_STAGES.find((s) => s.key === 'pre_enrollment');
    const visa = DEFAULT_STAGES.find((s) => s.key === 'visa');

    assert.strictEqual(pre.items.find((i) => i.key === 'pending_documents_reminder_sent').required, false);
    assert.strictEqual(visa.items.find((i) => i.key === 'visa_result_recorded').rule, 'VISA_OUTCOME_SET');
    assert.strictEqual(visa.items.find((i) => i.key === 'visa_appointment_date_recorded').rule, 'VISA_APPOINTMENT_SET');
});

test('ensureConfig creates one config per business and is idempotent', async () => {
    const business = await h.makeBusiness();

    const first = await ensureConfig(business._id);
    const second = await ensureConfig(business._id);

    assert.strictEqual(first._id.toString(), second._id.toString());
    assert.strictEqual(await AdmissionConfig.countDocuments({ businessId: business._id }), 1);
    assert.strictEqual(first.timezone, 'Asia/Kolkata');
    assert.strictEqual(first.stages[0].stuckThresholdDays, 7);
    assert.deepStrictEqual(getActiveStages(first).map((s) => s.order), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(first.documentTypes.some((d) => d.key === 'passport' && d.hasExpiry));
    assert.ok(first.leadSources.some((s) => s.key === 'instagram'));
});

test('business admissions feature is off by default', async () => {
    const business = await Business.create({ businessName: 'Plain', email: 'plain@example.com' });
    assert.strictEqual(business.features.admissions, false);
});

test('normalizePhone keeps digits and compares on the last ten', () => {
    assert.strictEqual(normalizePhone('+91 98765-43210'), '9876543210');
    assert.strictEqual(normalizePhone('098765 43210'), '9876543210');
    assert.strictEqual(normalizePhone('9876543210'), '9876543210');
    assert.strictEqual(normalizePhone('+420 777 123 456'), '0777123456');
    assert.strictEqual(normalizePhone(''), '');
    assert.strictEqual(normalizePhone(null), '');
});

test('parseMoney accepts plain decimals and rejects ambiguous input', () => {
    assert.deepStrictEqual(parseMoney('1500.5'), { ok: true, minor: 150050 });
    assert.deepStrictEqual(parseMoney(1500), { ok: true, minor: 150000 });
    assert.deepStrictEqual(parseMoney('0.01'), { ok: true, minor: 1 });

    for (const bad of ['1,500', '10.555', 0, '0', -5, '-5', 'abc', '', null, undefined, NaN, Infinity]) {
        const result = parseMoney(bad);
        assert.strictEqual(result.ok, false, `expected ${String(bad)} to be rejected`);
        assert.ok(result.message.length > 0);
    }

    assert.strictEqual(formatMinor(150050), '1500.50');
    assert.strictEqual(formatMinor(7), '0.07');
});

test('migration 001 backfills normalised phone digits once', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });

    // Insert directly so model hooks don't set phoneDigits (simulates pre-existing data)
    await Lead.collection.insertOne({
        businessId: business._id,
        customerName: 'Old Lead',
        phone: '+91 98765-43210',
        createdBy: owner._id,
        status: 'NEW',
    });

    const applied = await runMigrations();
    assert.ok(applied.includes('001-lead-phone-digits'));

    const lead = await Lead.findOne({ customerName: 'Old Lead' });
    assert.strictEqual(lead.phoneDigits, '9876543210');

    assert.deepStrictEqual(await runMigrations(), []);
});

test('saving or updating a lead keeps phoneDigits in sync', async () => {
    const business = await h.makeBusiness();
    const owner = await h.makeUser(business, { role: 'OWNER' });

    const lead = await Lead.create({
        businessId: business._id,
        customerName: 'Hook Lead',
        phone: '+91 91234 56789',
        createdBy: owner._id,
    });
    assert.strictEqual(lead.phoneDigits, '9123456789');

    const updated = await Lead.findOneAndUpdate(
        { _id: lead._id },
        { $set: { phone: '+91 99999 00000' } },
        { new: true }
    );
    assert.strictEqual(updated.phoneDigits, '9999900000');
});
