const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Business = require('../models/Business');
const { BUSINESS_CURRENCIES } = require('../models/Business');
const { can } = require('../services/access');
const { getStorage } = require('../services/storage');
const {
    buildStorageKey,
    detectFileType,
    safeOriginalName,
    scanFile,
    sha256,
} = require('../services/storage/fileValidation');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);

const loadSettings = async (userId, businessId) => {
    const [user, business] = await Promise.all([
        User.findById(userId).select('name email phone role password googleId'),
        Business.findById(businessId).select('businessName email phone address gstin currency features logo'),
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
            logoUrl: business.logo?.storageKey
                ? `/api/settings/logo/${business._id}?v=${business.logo.updatedAt?.getTime?.() || business.updatedAt?.getTime?.() || ''}`
                : '',
            logoName: business.logo?.originalName || '',
        },
        features: { admissions: business.features?.admissions === true },
        currencies: BUSINESS_CURRENCIES,
    };
};

/** Public, cacheable workspace logo. The opaque storage key stays private. */
const getBusinessLogo = async (req, res, next) => {
    try {
        if (!require('mongoose').isValidObjectId(req.params.businessId)) {
            return fail(res, 404, 'Logo not found');
        }

        const business = await Business.findById(req.params.businessId).select('logo');
        if (!business?.logo?.storageKey || !business.logo.mimeType) {
            return fail(res, 404, 'Logo not found');
        }

        res.set({
            'Content-Type': business.logo.mimeType,
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
            ETag: `"${business.logo.sha256}"`,
        });
        if (req.headers['if-none-match'] === `"${business.logo.sha256}"`) return res.status(304).end();

        const stream = await getStorage().getStream(business.logo.storageKey);
        stream.on('error', next);
        return stream.pipe(res);
    } catch (error) {
        next(error);
    }
};

/** Uploads or replaces the workspace logo. Owner only. */
const uploadBusinessLogo = async (req, res, next) => {
    let newStorageKey = null;
    try {
        if (!can(req, 'settings.business')) return fail(res, 403, 'You do not have permission to change the workspace logo');
        if (!req.file?.buffer?.length) return fail(res, 400, 'Choose a logo to upload');
        if (req.file.buffer.length > MAX_LOGO_BYTES) return fail(res, 413, 'Logo must be 2 MB or smaller');

        const type = detectFileType(req.file.buffer);
        if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type.mime)) {
            return fail(res, 400, 'Logo must be a JPG, PNG or WEBP image');
        }

        const scan = await scanFile(req.file.buffer);
        if (!scan.clean) return fail(res, 400, 'This logo failed the security scan');

        const business = await Business.findOne({ _id: req.user.businessId, isActive: true }).select('logo');
        if (!business) return fail(res, 404, 'Business not found');

        newStorageKey = buildStorageKey(req.user.businessId, req.user.businessId, type.ext);
        await getStorage().put(newStorageKey, req.file.buffer, type.mime);

        const previousKey = business.logo?.storageKey || '';
        business.logo = {
            storageKey: newStorageKey,
            originalName: safeOriginalName(req.file.originalname || `logo.${type.ext}`),
            mimeType: type.mime,
            size: req.file.buffer.length,
            sha256: sha256(req.file.buffer),
            updatedAt: new Date(),
        };
        await business.save();
        newStorageKey = null;

        if (previousKey) await getStorage().remove(previousKey).catch(() => {});
        return respond(req, res, 'Workspace logo saved');
    } catch (error) {
        if (newStorageKey) await getStorage().remove(newStorageKey).catch(() => {});
        next(error);
    }
};

/** Removes the workspace logo and returns the updated settings. Owner only. */
const removeBusinessLogo = async (req, res, next) => {
    try {
        if (!can(req, 'settings.business')) return fail(res, 403, 'You do not have permission to change the workspace logo');
        const business = await Business.findOne({ _id: req.user.businessId, isActive: true }).select('logo');
        if (!business) return fail(res, 404, 'Business not found');

        const previousKey = business.logo?.storageKey || '';
        business.logo = undefined;
        await business.save();
        if (previousKey) await getStorage().remove(previousKey).catch(() => {});
        return respond(req, res, 'Workspace logo removed');
    } catch (error) {
        next(error);
    }
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
        if (!can(req, 'settings.business')) return fail(res, 403, 'You do not have permission to change business details');

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

module.exports = {
    getSettings,
    getBusinessLogo,
    updateProfile,
    updateBusiness,
    uploadBusinessLogo,
    removeBusinessLogo,
    changePassword,
};
