const mongoose = require('mongoose');

const BUSINESS_CURRENCIES = ['INR', 'USD', 'EUR', 'CZK', 'GBP', 'AED'];

const businessSchema = new mongoose.Schema(
    {
        businessName: {
            type: String,
            required: [true, 'Business name is required'],
            trim: true,
            maxlength: 100,
        },

        email: {
            type: String,
            required: [true, 'Business email is required'],
            lowercase: true,
            trim: true,
        },

        phone: {
            type: String,
            trim: true,
            default: '',
        },

        address: {
            type: String,
            trim: true,
            default: '',
        },

        gstin: {
            type: String,
            trim: true,
            uppercase: true,
            default: '',
        },

        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        // Currency for lead values and the sales pipeline (display only, no conversion)
        currency: {
            type: String,
            enum: BUSINESS_CURRENCIES,
            default: 'USD',
        },

        // Private storage metadata for the workspace logo. Only the public
        // logo endpoint exposes the image; the storage key never leaves the API.
        logo: {
            storageKey: { type: String, default: '' },
            originalName: { type: String, default: '' },
            mimeType: { type: String, default: '' },
            size: { type: Number, default: 0 },
            sha256: { type: String, default: '' },
            updatedAt: { type: Date, default: null },
        },

        // Optional modules switched on per business (see scripts/admissions-enable.js)
        features: {
            admissions: {
                type: Boolean,
                default: false,
            },
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Business', businessSchema);
module.exports.BUSINESS_CURRENCIES = BUSINESS_CURRENCIES;
