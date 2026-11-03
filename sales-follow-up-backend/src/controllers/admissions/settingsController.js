const mongoose = require('mongoose');
const University = require('../../models/University');
const AdmissionApplication = require('../../models/AdmissionApplication');
const { CONDITIONS, RULES, GATES, PAYMENT_CATEGORIES } = require('../../services/admissions/defaultConfig');
const { isAdmin } = require('../../services/admissions/access');
const { isValidTimeZone } = require('../../services/admissions/time');
const reminders = require('../../services/admissions/reminders');
const { serializeConfig } = require('./contextController');

const KEY_PATTERN = /^[a-z0-9_]{2,60}$/;

const REMINDER_LIMITS = {
    followUpMinutesBefore: 10080,
    interviewDaysBefore: 60,
    examDaysBefore: 60,
    visaDaysBefore: 60,
    paymentDaysBefore: 60,
    documentExpiryDaysBefore: 365,
};

class SettingsError extends Error {}
const reject = (message) => {
    throw new SettingsError(message);
};

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const requireAdmin = (req, res) => {
    if (isAdmin(req)) return true;
    fail(res, 403, 'Only an admin can change admissions settings');
    return false;
};

const slugify = (text) =>
    String(text)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50);

/** Uses the given key, or derives one from the name; reports duplicates. */
const claimKey = (input, name, used, what) => {
    let key = input.key;
    if (key !== undefined && key !== null && key !== '') {
        if (!KEY_PATTERN.test(key)) reject(`${what} key "${key}" may only use lowercase letters, numbers and _`);
        if (used.has(key)) reject(`${what} key "${key}" is used more than once`);
    } else {
        const base = slugify(name).padEnd(2, '_') || 'item';
        key = base;
        for (let n = 2; used.has(key); n += 1) key = `${base}_${n}`;
    }
    used.add(key);
    return key;
};

const textField = (value, max, what) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > max) reject(`${what} must be between 1 and ${max} characters`);
    return text;
};

const enumOrNull = (value, allowed, what) => {
    if (value === undefined || value === null || value === '') return null;
    if (!allowed.includes(value)) reject(`Invalid ${what} "${value}"`);
    return value;
};

/** Every existing key must still be present (archived is fine). */
const ensureKept = (existing, nextKeys, what, nameOf) => {
    for (const entry of existing) {
        if (!nextKeys.has(entry.key)) reject(`${what} "${nameOf(entry)}" is in use — archive it instead of removing it`);
    }
};

const validateStages = (input, current) => {
    if (!Array.isArray(input) || input.length === 0 || input.length > 30) reject('Add between 1 and 30 stages');

    const stageKeys = new Set();
    const itemKeys = new Set();

    const stages = input.map((raw, index) => {
        const name = textField(raw?.name, 100, 'Stage name');
        const key = claimKey(raw, name, stageKeys, 'Stage');
        const existing = current.find((s) => s.key === key);

        const threshold = Number(raw.stuckThresholdDays ?? existing?.stuckThresholdDays ?? 7);
        if (!Number.isInteger(threshold) || threshold < 1 || threshold > 365) {
            reject(`"${name}": the stuck limit must be a whole number of days between 1 and 365`);
        }

        if (!Array.isArray(raw.items) || raw.items.length > 50) reject(`"${name}": add at most 50 checklist items`);
        const items = raw.items.map((rawItem) => {
            const label = textField(rawItem?.label, 200, 'Checklist item');
            return {
                key: claimKey(rawItem, label, itemKeys, 'Checklist item'),
                label,
                required: rawItem.required !== false,
                condition: enumOrNull(rawItem.condition, CONDITIONS, 'condition'),
                rule: enumOrNull(rawItem.rule, RULES, 'rule'),
                paymentCategory: enumOrNull(rawItem.paymentCategory, PAYMENT_CATEGORIES, 'payment category'),
                isArchived: rawItem.isArchived === true,
            };
        });

        if (existing) {
            ensureKept(existing.items, new Set(items.map((i) => i.key)), 'Checklist item', (i) => i.label);
        }

        return {
            key,
            name,
            order: index + 1,
            stuckThresholdDays: threshold,
            gate: enumOrNull(raw.gate ?? existing?.gate, GATES, 'gate'),
            isArchived: raw.isArchived === true,
            items,
        };
    });

    ensureKept(current, stageKeys, 'Stage', (s) => s.name);
    if (!stages.some((s) => !s.isArchived)) reject('Keep at least one active stage');
    return stages;
};

const validateNamedList = (input, current, what, extra = () => ({})) => {
    if (!Array.isArray(input) || input.length > 100) reject(`Add at most 100 ${what.toLowerCase()}s`);
    const used = new Set();
    const list = input.map((raw) => {
        const name = textField(raw?.name, 100, `${what} name`);
        return { key: claimKey(raw, name, used, what), name, isArchived: raw.isArchived === true, ...extra(raw) };
    });
    ensureKept(current, used, what, (e) => e.name);
    return list;
};

const validateReminders = (input, current) => {
    const value = {};
    for (const [field, max] of Object.entries(REMINDER_LIMITS)) {
        const n = Number(input?.[field] ?? current[field]);
        if (!Number.isInteger(n) || n < 0 || n > max) {
            reject('Reminder settings must be whole numbers within their allowed range');
        }
        value[field] = n;
    }
    return value;
};

const getSettings = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    return res.json({ success: true, data: serializeConfig(req.admissionsConfig) });
};

const updateSettings = async (req, res, next) => {
    try {
        if (!requireAdmin(req, res)) return;
        const body = req.body || {};
        const config = req.admissionsConfig;
        const plain = config.toObject();

        const stages = body.stages !== undefined ? validateStages(body.stages, plain.stages) : plain.stages;
        const documentTypes =
            body.documentTypes !== undefined
                ? validateNamedList(body.documentTypes, plain.documentTypes, 'Document type', (raw) => ({ hasExpiry: raw.hasExpiry === true }))
                : plain.documentTypes;
        const leadSources =
            body.leadSources !== undefined ? validateNamedList(body.leadSources, plain.leadSources, 'Lead source') : plain.leadSources;
        if (!leadSources.some((s) => !s.isArchived)) reject('Keep at least one active lead source');

        const reminderDefaults = validateReminders(body.reminderDefaults, plain.reminderDefaults);

        const timezone = body.timezone ?? plain.timezone;
        if (typeof timezone !== 'string' || !isValidTimeZone(timezone)) reject('Choose a valid timezone, such as Asia/Kolkata');

        const remindersChanged = JSON.stringify(reminderDefaults) !== JSON.stringify(plain.reminderDefaults);

        config.set({ stages, documentTypes, leadSources, reminderDefaults, timezone });
        await config.save();

        if (remindersChanged) {
            const active = await AdmissionApplication.find({ businessId: req.user.businessId, status: 'ACTIVE' }).select('_id');
            for (const { _id } of active) await reminders.syncRemindersForApplication(_id);
        }

        return res.json({ success: true, message: 'Settings saved', data: serializeConfig(config) });
    } catch (error) {
        if (error instanceof SettingsError) return fail(res, 400, error.message);
        next(error);
    }
};

const validateCourses = (input, current = []) => {
    if (!Array.isArray(input) || input.length > 200) reject('Add at most 200 courses');
    const courses = input.map((raw) => {
        const name = textField(raw?.name, 150, 'Course name');
        if (!['BACHELOR', 'MASTER'].includes(raw.level)) reject(`"${name}": choose Bachelor's or Master's`);
        const id = mongoose.isValidObjectId(raw._id) && current.some((c) => String(c._id) === String(raw._id)) ? raw._id : undefined;
        return {
            ...(id && { _id: id }),
            name,
            level: raw.level,
            language: typeof raw.language === 'string' ? raw.language.trim().slice(0, 50) : '',
            isArchived: raw.isArchived === true,
        };
    });

    const kept = new Set(courses.filter((c) => c._id).map((c) => String(c._id)));
    for (const course of current) {
        if (!kept.has(String(course._id))) reject(`Course "${course.name}" is in use — archive it instead of removing it`);
    }
    return courses;
};

const universityFields = (body) => ({
    name: textField(body.name, 150, 'University name'),
    city: typeof body.city === 'string' ? body.city.trim().slice(0, 100) : '',
    website: typeof body.website === 'string' ? body.website.trim().slice(0, 300) : '',
});

const listUniversities = async (req, res, next) => {
    try {
        const universities = await University.find({ businessId: req.user.businessId }).sort({ name: 1 });
        return res.json({ success: true, data: universities });
    } catch (error) {
        next(error);
    }
};

const createUniversity = async (req, res, next) => {
    try {
        if (!requireAdmin(req, res)) return;
        const body = req.body || {};
        const university = await University.create({
            businessId: req.user.businessId,
            ...universityFields(body),
            courses: validateCourses(body.courses || []),
        });
        return res.status(201).json({ success: true, data: university });
    } catch (error) {
        if (error instanceof SettingsError) return fail(res, 400, error.message);
        next(error);
    }
};

const updateUniversity = async (req, res, next) => {
    try {
        if (!requireAdmin(req, res)) return;
        const body = req.body || {};
        const university = mongoose.isValidObjectId(req.params.id)
            ? await University.findOne({ _id: req.params.id, businessId: req.user.businessId })
            : null;
        if (!university) return fail(res, 404, 'University not found');

        university.set(universityFields({ ...university.toObject(), ...body }));
        if (body.courses !== undefined) university.courses = validateCourses(body.courses, university.courses);
        if (body.isArchived !== undefined) university.isArchived = body.isArchived === true;
        await university.save();

        return res.json({ success: true, data: university });
    } catch (error) {
        if (error instanceof SettingsError) return fail(res, 400, error.message);
        next(error);
    }
};

module.exports = { getSettings, updateSettings, listUniversities, createUniversity, updateUniversity };
