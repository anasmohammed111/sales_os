const mongoose = require('mongoose');

const PLAN_STATUSES = ['ACTIVE', 'ARCHIVED'];
const PLAN_MODULES = ['crm', 'admissions'];

const limitsSchema = new mongoose.Schema(
    {
        users: { type: Number, min: 0, default: 0 },
        leads: { type: Number, min: 0, default: 0 },
        students: { type: Number, min: 0, default: 0 },
        storageMb: { type: Number, min: 0, default: 0 },
    },
    { _id: false }
);

// A versioned commercial offer. Subscriptions keep a snapshot, so editing a
// plan never rewrites the price or limits a customer previously accepted.
const planSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            uppercase: true,
            trim: true,
            match: /^[A-Z][A-Z0-9_]{1,39}$/,
        },
        name: { type: String, required: true, trim: true, maxlength: 100 },
        description: { type: String, trim: true, default: '', maxlength: 500 },
        currency: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z]{3}$/ },
        prices: {
            monthly: { type: Number, required: true, min: 0 },
            yearly: { type: Number, required: true, min: 0 },
        },
        trialDays: { type: Number, min: 0, max: 365, default: 0 },
        limits: { type: limitsSchema, default: () => ({}) },
        modules: [{ type: String, enum: PLAN_MODULES }],
        status: { type: String, enum: PLAN_STATUSES, default: 'ACTIVE' },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin', default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin', default: null },
    },
    { timestamps: true }
);

planSchema.index({ status: 1, name: 1 });

module.exports = mongoose.model('Plan', planSchema);
module.exports.PLAN_STATUSES = PLAN_STATUSES;
module.exports.PLAN_MODULES = PLAN_MODULES;

