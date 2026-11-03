const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Business = require('../models/Business');
const { BUSINESS_CURRENCIES } = require('../models/Business');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);

const loadSettings = async (userId, businessId) => {
    const [user, business] = await Promise.all([
        User.findById(userId).select('name email phone role password googleId'),
        Business.findById(businessId).select('businessName email phone address gstin currency features'),
    ]);
    if (!user || !business) return null;

    return {
        profile: {
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            role: user.role,
            hasPassword: Boolean(user.password),
            hasGoogle: Boolean(user.googleId),
        },
        business: {
            id: business._id,
            businessName: business.businessName,
            email: business.email,
            phone: business.phone,
            address: business.address,
            gstin: business.gstin,
            currency: business.currency || 'USD',
        },
        features: { admissions: business.features?.admissions === true },
        currencies: BUSINESS_CURRENCIES,
    };
};

const respond = async (req, res, message) => {
    const data = await loadSettings(req.user.userId, req.user.businessId);
    if (!data) return fail(res, 404, 'Account not found');
    return res.json({ success: true, ...(message && { message }), data });
};

const getSettings = async (req, res, next) => {
    try {
        return respond(req, res);
    } catch (error) {
        next(error);
    }
};

/** Your own name and phone. Email and role are managed elsewhere. */
const updateProfile = async (req, res, next) => {
    try {
        const updates = {};
        const name = text(req.body?.name, 100);
        if (name !== undefined) {
            if (name.length < 2) return fail(res, 400, 'Name must be between 2 and 100 characters');
            updates.name = name;
        }
        const phone = text(req.body?.phone, 30);
        if (phone !== undefined) updates.phone = phone;

        if (!Object.keys(updates).length) return fail(res, 400, 'Nothing to update');
        await User.updateOne({ _id: req.user.userId, businessId: req.user.businessId }, { $set: updates });
        return respond(req, res, 'Profile saved');
    } catch (error) {
        next(error);
    }
};

/** Business details and currency. Owner only. */
const updateBusiness = async (req, res, next) => {
    try {
        if (req.user.role !== 'OWNER') return fail(res, 403, 'Only the business owner can change business details');

        const body = req.body || {};
        const updates = {};

        if (body.businessName !== undefined) {
            const name = text(body.businessName, 100);
            if (!name) return fail(res, 400, 'Business name is required');
            updates.businessName = name;
        }
        if (body.email !== undefined) {
            const email = (text(body.email, 254) || '').toLowerCase();
            if (!EMAIL_PATTERN.test(email)) return fail(res, 400, 'Please enter a valid business email');
            updates.email = email;
        }
        if (body.phone !== undefined) updates.phone = text(body.phone, 30) || '';
        if (body.address !== undefined) updates.address = text(body.address, 300) || '';
        if (body.gstin !== undefined) updates.gstin = (text(body.gstin, 20) || '').toUpperCase();
        if (body.currency !== undefined) {
            if (!BUSINESS_CURRENCIES.includes(body.currency)) {
                return fail(res, 400, `Currency must be one of ${BUSINESS_CURRENCIES.join(', ')}`);
            }
            updates.currency = body.currency;
        }

        if (!Object.keys(updates).length) return fail(res, 400, 'Nothing to update');
        await Business.updateOne({ _id: req.user.businessId }, { $set: updates });
        return respond(req, res, 'Business details saved');
    } catch (error) {
        next(error);
    }
};

/**
 * Changes your password. The current password is required, except for
 * accounts that have none yet (signed up with Google).
 * Wrong current password answers 400, not 401, so the app doesn't sign you out.
 */
const changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        const user = await User.findOne({ _id: req.user.userId, businessId: req.user.businessId });
        if (!user) return fail(res, 404, 'Account not found');

        if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
            return fail(res, 400, `The new password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters`);
        }

        if (user.password) {
            const matches =
                typeof currentPassword === 'string' &&
                currentPassword.length <= MAX_PASSWORD &&
                (await bcrypt.compare(currentPassword, user.password));
            if (!matches) return fail(res, 400, 'Your current password is not correct');
        }

        user.password = await bcrypt.hash(newPassword, 12);
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();

        return respond(req, res, 'Password changed');
    } catch (error) {
        next(error);
    }
};

module.exports = { getSettings, updateProfile, updateBusiness, changePassword };
