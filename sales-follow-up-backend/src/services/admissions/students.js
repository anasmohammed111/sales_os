const mongoose = require('mongoose');
const Lead = require('../../models/Leads');
const AdmissionApplication = require('../../models/AdmissionApplication');
const { normalizePhone } = require('./phone');
const { getScopedCounsellorIds } = require('./access');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admissions lead-source keys mapped onto the CRM's Lead.source values
const LEAD_SOURCE_MAP = {
    instagram: 'INSTAGRAM',
    whatsapp: 'WHATSAPP',
    website: 'WEBSITE',
    walk_in: 'WALK_IN',
    referral: 'REFERRAL',
};

const mapLeadSource = (key) => LEAD_SOURCE_MAP[key] || 'OTHER';

const snapshotFromLead = (lead) => ({
    name: lead.customerName || '',
    email: lead.email || '',
    phone: lead.phone || '',
    phoneDigits: lead.phoneDigits || normalizePhone(lead.phone),
    whatsapp: lead.whatsapp || '',
    city: lead.city || '',
});

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Validates student contact details. Returns { value } or { error }. */
const validateStudentInput = (input) => {
    if (!input || typeof input !== 'object') return { error: 'Student details are required' };

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 2 || name.length > 120) {
        return { error: 'Student name must be between 2 and 120 characters' };
    }

    const email = text(input.email, 254).toLowerCase();
    if (email && !EMAIL_PATTERN.test(email)) return { error: 'Please enter a valid email address' };

    const phone = text(input.phone, 30);
    if (!email && !phone) return { error: 'Enter a phone number or an email address for the student' };

    return {
        value: {
            name,
            email,
            phone,
            whatsapp: text(input.whatsapp, 30),
            city: text(input.city, 100),
        },
    };
};

/** Whether the user may work with this student (has the lead or one of its applications in scope). */
const isStudentInScope = (lead, applications, scopedIds) => {
    if (!scopedIds) return true;
    const ids = new Set(scopedIds.map(String));
    if (lead.assignedTo && ids.has(String(lead.assignedTo))) return true;
    return applications.some((a) => a.counsellorId && ids.has(String(a.counsellorId)));
};

/**
 * Possible duplicate students by normalised email or phone. Never merges.
 * Records outside the user's scope are reported without personal details.
 */
const findDuplicateStudents = async (req, { email, phone, excludeStudentId } = {}) => {
    const normalizedEmail = text(email, 254).toLowerCase();
    const digits = normalizePhone(phone);

    const or = [];
    if (normalizedEmail) or.push({ email: normalizedEmail });
    if (digits.length >= 7) or.push({ phoneDigits: digits });
    if (!or.length) return [];

    const filter = { businessId: req.user.businessId, isArchived: { $ne: true }, $or: or };
    if (mongoose.isValidObjectId(excludeStudentId)) filter._id = { $ne: excludeStudentId };

    const leads = await Lead.find(filter).limit(10);
    if (!leads.length) return [];

    const [scopedIds, applications] = await Promise.all([
        getScopedCounsellorIds(req),
        AdmissionApplication.find({ businessId: req.user.businessId, studentId: { $in: leads.map((l) => l._id) } })
            .select('studentId counsellorId intakeMonth intakeYear studyLevel currentStageKey status')
            .lean(),
    ]);

    return leads.map((lead) => {
        const matchedOn = [];
        if (normalizedEmail && lead.email === normalizedEmail) matchedOn.push('email');
        if (digits.length >= 7 && lead.phoneDigits === digits) matchedOn.push('phone');

        const own = applications.filter((a) => String(a.studentId) === String(lead._id));
        if (!isStudentInScope(lead, own, scopedIds)) {
            return { matchedOn, inScope: false };
        }

        return {
            inScope: true,
            matchedOn,
            studentId: lead._id,
            name: lead.customerName,
            email: lead.email,
            phone: lead.phone,
            applications: own.map((a) => ({
                id: a._id,
                studyLevel: a.studyLevel,
                intakeMonth: a.intakeMonth,
                intakeYear: a.intakeYear,
                currentStageKey: a.currentStageKey,
                status: a.status,
            })),
        };
    });
};

module.exports = {
    mapLeadSource,
    snapshotFromLead,
    validateStudentInput,
    isStudentInScope,
    findDuplicateStudents,
};
