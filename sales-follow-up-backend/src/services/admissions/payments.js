const mongoose = require('mongoose');

/** A fee still waiting for money: no amount set yet, or a balance left. */
const isOpen = (fee) => fee.needsAmount === true || fee.outstandingMinor > 0;

/** Paid / outstanding / status for one fee, from its non-voided transactions. */
const computeFee = (fee) => {
    const paidMinor = (fee.transactions || [])
        .filter((t) => !t.isVoided)
        .reduce((sum, t) => sum + t.amountMinor, 0);
    const outstandingMinor = Math.max(fee.amountDueMinor - paidMinor, 0);
    const status = paidMinor === 0 ? 'UNPAID' : paidMinor >= fee.amountDueMinor ? 'PAID' : 'PARTIALLY_PAID';
    return { paidMinor, outstandingMinor, status };
};

/** Totals per currency. Different currencies are never added together. */
const summarize = (fees) => {
    const byCurrency = new Map();
    for (const fee of fees) {
        const row = byCurrency.get(fee.currency) || { currency: fee.currency, dueMinor: 0, paidMinor: 0, outstandingMinor: 0 };
        row.dueMinor += fee.amountDueMinor;
        row.paidMinor += fee.paidMinor;
        row.outstandingMinor += fee.outstandingMinor;
        byCurrency.set(fee.currency, row);
    }
    return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
};

/** Overall payment status across an application's fees. */
const overallStatus = (fees) => {
    if (!fees.length) return 'NONE';
    if (fees.every((f) => f.status === 'PAID')) return 'PAID';
    if (fees.every((f) => f.status === 'UNPAID')) return 'UNPAID';
    return 'PARTIALLY_PAID';
};

/** Recomputes the payment summary stored on the application (used by lists and filters). */
const refreshApplicationPayments = async (applicationId) => {
    const AdmissionFee = mongoose.model('AdmissionFee');
    const AdmissionApplication = mongoose.model('AdmissionApplication');

    const fees = await AdmissionFee.find({ applicationId, isArchived: { $ne: true } });
    const dueDates = fees.filter((f) => f.outstandingMinor > 0 && f.dueDate).map((f) => f.dueDate.getTime());

    await AdmissionApplication.updateOne(
        { _id: applicationId },
        {
            $set: {
                paymentSummary: {
                    status: overallStatus(fees),
                    nextDueAt: dueDates.length ? new Date(Math.min(...dueDates)) : null,
                    byCurrency: summarize(fees),
                    openScheduledFees: fees
                        .filter((f) => f.scheduleKey && isOpen(f))
                        .map((f) => ({
                            feeId: f._id,
                            scheduleKey: f.scheduleKey,
                            name: f.label,
                            outstandingMinor: f.outstandingMinor,
                            currency: f.currency,
                            needsAmount: f.needsAmount === true,
                        })),
                },
            },
        }
    );
};

module.exports = { isOpen, computeFee, summarize, overallStatus, refreshApplicationPayments };
