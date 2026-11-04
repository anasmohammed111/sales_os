const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Business = require('../models/Business');
const User = require('../models/User');
const University = require('../models/University');
const { ensureConfig } = require('../services/admissions/configService');
const { backfillUserRoles } = require('../services/access');

// Real setup data only. No sample students or leads.
const BUSINESS = { businessName: 'SYB Education', email: 'admin@syb.local', currency: 'INR' };

const TEAM = [
    { key: 'admin', name: 'SYB Admin', email: 'admin@syb.local', role: 'OWNER' },
    { key: 'manager', name: 'Admissions Manager', email: 'manager@syb.local', role: 'SALES_MANAGER' },
    { key: 'counsellor1', name: 'Counsellor One', email: 'counsellor1@syb.local', role: 'SALESPERSON', reportsTo: 'manager' },
    { key: 'counsellor2', name: 'Counsellor Two', email: 'counsellor2@syb.local', role: 'SALESPERSON', reportsTo: 'manager' },
];

// Universities only; courses change every year, so admins add them in Settings
const UNIVERSITIES = [
    ['Charles University', 'Prague'],
    ['Czech Technical University in Prague', 'Prague'],
    ['Prague University of Economics and Business', 'Prague'],
    ['Czech University of Life Sciences Prague', 'Prague'],
    ['University of Chemistry and Technology, Prague', 'Prague'],
    ['Masaryk University', 'Brno'],
    ['Brno University of Technology', 'Brno'],
    ['VSB – Technical University of Ostrava', 'Ostrava'],
    ['Palacký University Olomouc', 'Olomouc'],
    ['University of West Bohemia', 'Pilsen'],
];

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 18 random characters with at least one upper, lower and digit. */
const generatePassword = () => {
    for (;;) {
        const bytes = crypto.randomBytes(18);
        const password = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
        if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)) return password;
    }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Creates the SYB business, its admin and team, the admissions settings and
 * the university list. Safe to run again: existing accounts are never
 * changed, and passwords are only generated (and returned) for new accounts.
 */
const seedSyb = async () => {
    const created = [];
    const existing = [];
    const skipped = [];

    let admin = await User.findOne({ email: TEAM[0].email });
    let business = admin ? await Business.findById(admin.businessId) : null;

    if (!business) {
        business = await Business.create({ ...BUSINESS, features: { admissions: true } });
    } else if (business.features?.admissions !== true) {
        business.features = { ...(business.features?.toObject?.() ?? {}), admissions: true };
        await business.save();
    }

    const people = {};
    for (const member of TEAM) {
        const found = await User.findOne({ email: member.email });

        if (found && String(found.businessId) !== String(business._id)) {
            skipped.push(member.email);
            continue;
        }
        if (found) {
            existing.push(member.email);
            people[member.key] = found;
            continue;
        }

        const password = generatePassword();
        const user = await User.create({
            businessId: business._id,
            name: member.name,
            email: member.email,
            password: await bcrypt.hash(password, 12),
            role: member.role,
            managerId: member.reportsTo ? people[member.reportsTo]?._id ?? null : null,
        });
        people[member.key] = user;
        created.push({ name: member.name, email: member.email, role: member.role, password });
    }

    admin = people.admin;
    if (admin && !business.owner) {
        business.owner = admin._id;
        await business.save();
    }

    await ensureConfig(business._id);
    // Built-in roles, and each seeded person linked to theirs
    await backfillUserRoles(business._id);

    let universitiesAdded = 0;
    for (const [name, city] of UNIVERSITIES) {
        const exists = await University.exists({ businessId: business._id, name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
        if (exists) continue;
        await University.create({ businessId: business._id, name, city, courses: [] });
        universitiesAdded += 1;
    }

    return { business, created, existing, skipped, universitiesAdded };
};

module.exports = { seedSyb, generatePassword, TEAM, UNIVERSITIES };
