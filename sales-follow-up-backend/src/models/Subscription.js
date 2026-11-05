const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'];
const BILLING_CYCLES = ['MONTHLY', 'YEARLY'];

const planSnapshotSchema = new mongoose.Schema(
    {
        key: { type: String, required: true },
        name: { type: String, required: true },
        currency: { type: String, required: true },
        prices: {
            monthly: { type: Number, required: true },
            yearly: { type: Number, required: true },
        },
        trialDays: { type: Number, default: 0 },
        limits: {
            users: { type: Number, default: 0 },
            leads: { type: Number, default: 0 },
            students: { type: Number, default: 0 },
            storageMb: { type: Number, default: 0 },
        },
        modules: [{ type: String }],
    },
    { _id: false }
);

const historySchema = new mongoose.Schema(
    {
        action: { type: String, required: true },
        fromStatus: { type: String, default: null },
        toStatus: { type: String, default: null },
        fromPlanKey: { type: String, default: null },
        toPlanKey: { type: String, default: null },
        reason: { type: String, required: true, maxlength: 500 },
        at: { type: Date, default: Date.now },
        by: { type: ObjectId, ref: 'PlatformAdmin', default: null },
    },
    { _id: true }
);

const subscriptionSchema = new mongoose.Schema(
    {
        businessId: { type: ObjectId, ref: 'Business', required: true, unique: true },
        planId: { type: ObjectId, ref: 'Plan', required: true },
        planSnapshot: { type: planSnapshotSchema, required: true },
        status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
        billingCycle: { type: String, enum: BILLING_CYCLES, required: true },
        amountMinor: { type: Number, required: true, min: 0 },
        currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
        trialEndsAt: { type: Date, default: null },
        currentPeriodStart: { type: Date, required: true },
        currentPeriodEnd: { type: Date, required: true },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        cancelledAt: { type: Date, default: null },
        notes: { type: String, trim: true, default: '', maxlength: 1000 },
        updatedBy: { type: ObjectId, ref: 'PlatformAdmin', default: null },
        history: { type: [historySchema], default: [] },
    },
    { timestamps: true }
);

subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
subscriptionSchema.index({ 'planSnapshot.key': 1, status: 1 });
subscriptionSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
module.exports.SUBSCRIPTION_STATUSES = SUBSCRIPTION_STATUSES;
module.exports.BILLING_CYCLES = BILLING_CYCLES;

