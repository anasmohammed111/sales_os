const mongoose = require('mongoose');
const { CONDITIONS, RULES, GATES, PAYMENT_CATEGORIES } = require('../services/admissions/defaultConfig');

const KEY_PATTERN = /^[a-z0-9_]{2,60}$/;

const checklistItemSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, match: KEY_PATTERN },
        label: { type: String, required: true, trim: true, maxlength: 200 },
        required: { type: Boolean, default: true },
        // When set, the item only applies if the application says so
        condition: { type: String, enum: [...CONDITIONS, null], default: null },
        // Data that must be recorded before the item can be completed
        rule: { type: String, enum: [...RULES, null], default: null },
        // Shown as a hint only; completing the item never records a payment
        paymentCategory: { type: String, enum: [...PAYMENT_CATEGORIES, null], default: null },
        isArchived: { type: Boolean, default: false },
    },
    { _id: false }
);

const stageSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, match: KEY_PATTERN },
        name: { type: String, required: true, trim: true, maxlength: 100 },
        order: { type: Number, required: true },
        stuckThresholdDays: { type: Number, min: 1, max: 365, default: 7 },
        gate: { type: String, enum: [...GATES, null], default: null },
        isArchived: { type: Boolean, default: false },
        items: [checklistItemSchema],
    },
    { _id: false }
);

const admissionConfigSchema = new mongoose.Schema(
    {
        businessId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Business',
            required: true,
            unique: true,
        },

        stages: [stageSchema],

        documentTypes: [
            {
                _id: false,
                key: { type: String, required: true, match: KEY_PATTERN },
                name: { type: String, required: true, trim: true, maxlength: 100 },
                hasExpiry: { type: Boolean, default: false },
                isArchived: { type: Boolean, default: false },
            },
        ],

        leadSources: [
            {
                _id: false,
                key: { type: String, required: true, match: KEY_PATTERN },
                name: { type: String, required: true, trim: true, maxlength: 100 },
                isArchived: { type: Boolean, default: false },
            },
        ],

        reminderDefaults: {
            followUpMinutesBefore: { type: Number, min: 0, max: 10080, default: 30 },
            interviewDaysBefore: { type: Number, min: 0, max: 60, default: 2 },
            examDaysBefore: { type: Number, min: 0, max: 60, default: 2 },
            visaDaysBefore: { type: Number, min: 0, max: 60, default: 2 },
            paymentDaysBefore: { type: Number, min: 0, max: 60, default: 3 },
            documentExpiryDaysBefore: { type: Number, min: 0, max: 365, default: 30 },
        },

        timezone: { type: String, default: 'Asia/Kolkata' },
    },
    { timestamps: true }
);

module.exports = mongoose.model('AdmissionConfig', admissionConfigSchema);
