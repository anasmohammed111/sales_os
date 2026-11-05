#!/usr/bin/env node
// Bootstraps Kelto platform administrators (the first super admin; after that,
// super admins can also add administrators in the admin app). Uses the
// database in .env (MONGO_URI).
//
//   node scripts/create-super-admin.js --email you@example.com --name "Your Name"
//       creates the account and prints a strong random password once
//   ... --role SUPPORT_ADMIN      role for the new account (default SUPER_ADMIN)
//   ... --password-stdin          read the password from stdin instead (min 12 characters)
//   node scripts/create-super-admin.js --reset-password --email you@example.com
//   node scripts/create-super-admin.js --deactivate --email you@example.com
//   node scripts/create-super-admin.js --activate --email you@example.com
//   node scripts/create-super-admin.js --list
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const PlatformAdmin = require('../src/models/PlatformAdmin');
const { ROLE_KEYS, roleOf } = require('../src/services/platform/roles');

const MIN_PASSWORD = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : null;
};

const fail = (message) => {
    console.error(`Error: ${message}`);
    process.exit(1);
};

const readStdin = () =>
    new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => (data += chunk));
        process.stdin.on('end', () => resolve(data.trim()));
    });

const newPassword = async () => {
    if (flag('password-stdin')) {
        const password = await readStdin();
        if (password.length < MIN_PASSWORD) fail(`the password must be at least ${MIN_PASSWORD} characters`);
        return { password, generated: false };
    }
    return { password: crypto.randomBytes(18).toString('base64url'), generated: true };
};

const databaseHost = (uri) => {
    try {
        return new URL(uri.replace(/^mongodb\+srv:/, 'https:').replace(/^mongodb:/, 'http:')).host;
    } catch {
        return 'unknown host';
    }
};

(async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) fail('MONGO_URI is not set in .env');

    const email = (value('email') || '').trim().toLowerCase();
    const name = (value('name') || '').trim();
    const listing = flag('list');
    if (!listing && !EMAIL.test(email)) fail('give a valid --email');

    console.log(`Database: ${databaseHost(uri)}`);
    await mongoose.connect(uri);

    if (listing) {
        const admins = await PlatformAdmin.find().select('name email role isActive lastLoginAt createdAt').sort({ createdAt: 1 });
        if (!admins.length) console.log('No super admins yet.');
        for (const a of admins) {
            console.log(`${a.email.padEnd(36)} ${a.name.padEnd(24)} ${roleOf(a).padEnd(15)} ${a.isActive ? 'active  ' : 'INACTIVE'} last sign-in ${a.lastLoginAt ? a.lastLoginAt.toISOString() : 'never'}`);
        }
    } else if (flag('deactivate') || flag('activate')) {
        const isActive = flag('activate');
        const result = await PlatformAdmin.updateOne({ email }, { $set: { isActive } });
        if (!result.matchedCount) fail(`no super admin with email ${email}`);
        console.log(`${email} is now ${isActive ? 'active' : 'deactivated (signed out everywhere on the next request)'}.`);
    } else if (flag('reset-password')) {
        const admin = await PlatformAdmin.findOne({ email });
        if (!admin) fail(`no super admin with email ${email}`);
        const { password, generated } = await newPassword();
        admin.password = await bcrypt.hash(password, 12);
        admin.failedLogins = 0;
        admin.lockedUntil = null;
        await admin.save();
        console.log(`Password reset for ${email}.`);
        if (generated) console.log(`New password (shown once, store it in a password manager): ${password}`);
    } else {
        if (!name) fail('give a --name');
        const role = value('role') || 'SUPER_ADMIN';
        if (!ROLE_KEYS.includes(role)) fail(`--role must be one of ${ROLE_KEYS.join(', ')}`);
        if (await PlatformAdmin.exists({ email })) fail(`${email} is already a super admin (use --reset-password to change the password)`);
        const { password, generated } = await newPassword();
        await PlatformAdmin.create({ name, email, role, password: await bcrypt.hash(password, 12) });
        console.log(`Platform administrator created: ${name} <${email}> (${role})`);
        if (generated) console.log(`Password (shown once, store it in a password manager): ${password}`);
        console.log('Sign in to the Kelto admin app.');
    }

    await mongoose.disconnect();
})().catch(async (error) => {
    console.error(`Error: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
