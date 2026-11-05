const mongoose = require('mongoose');
const { CURRENCIES } = require('../services/admissions/money');
const { PAYMENT_CATEGORIES } = require('../services/admissions/defaultConfig');

const { ObjectId } = mongoose.Schema.Types;

const FEE_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'];

const transactionSchema = new mongoose.Schema({
    amountMinor: { type: Number, required: true, min: 1 },
    paidAt: { type: Date, required: true },
    reference: { type: String, trim: true, default: '', maxlength: 120 },
    method: { type: String, trim: true, default: '', maxlength: 60 },
    receipt: {
        storageKey: { type: String, default: null },
        originalName: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        size: { type: Number, default: 0 },
    },
    recordedBy: { type: ObjectId, ref: 'User', required: true },
    recordedAt: { type: Date, default: Date.now },
    isVoided: { type: Boolean, default: false },
    voidReason: { type: String, trim: true, default: '' },
    voidedBy: { type: ObjectId, ref: 'User', default: null },
    voidedAt: { type: Date, default: null },
});

const admissionFeeSchema = new mongoose.Schema(
    {
        businessId: { type: ObjectId, ref: 'Business', required: true },
        applicationId: { type: ObjectId, ref: 'AdmissionApplication', required: true },
        category: { type: String, enum: PAYMENT_CATEGORIES, required: true },
        label: { type: String, trim: true, default: '', maxlength: 120 },
        // 0 only while needsAmount is true
        amountDueMinor: { type: Number, required: true, min: 0 },
        // Added from the fee list without a fixed amount; staff set it per student
        needsAmount: { type: Boolean, default: false },
        // The fee-list entry this came from (null for fees added by hand)
        scheduleKey: { type: String, default: null },
        stageKey: { type: String, default: null },
        // Counted when a refund rule applies
        refundable: { type: Boolean, default: false },
        currency: { type: String, enum: CURRENCIES, required: true },
        dueDate: { type: Date, default: null },
        notes: { type: String, trim: true, default: '', maxlength: 1000 },
        transactions: [transactionSchema],

        // Derived on save from non-voided transactions
        paidMinor: { type: Number, default: 0 },
        outstandingMinor: { type: Number, default: 0 },
        status: { type: String, enum: FEE_STATUSES, default: 'UNPAID' },

        createdBy: { type: ObjectId, ref: 'User', required: true },
        isArchived: { type: Boolean, default: false },
    },
    { timestamps: true }
);

admissionFeeSchema.pre('save', function () {
    // Lazy require avoids a cycle: payments.js requires this model
    const { computeFee } = require('../services/admissions/payments');
    Object.assign(this, computeFee(this));
});

admissionFeeSchema.index({ businessId: 1, applicationId: 1 });
// A fee-list entry is on a student at most once (removed ones may be added again)
admissionFeeSchema.index(
    { applicationId: 1, scheduleKey: 1 },
    { unique: true, partialFilterExpression: { scheduleKey: { $type: 'string' }, isArchived: false } }
);
admissionFeeSchema.index({ businessId: 1, status: 1, dueDate: 1 });

module.exports = mongoose.model('AdmissionFee', admissionFeeSchema);
module.exports.FEE_STATUSES = FEE_STATUSES;
