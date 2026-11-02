const Quotation = require('../models/Quotation');

/**
 * Automatically marks all SENT quotations past their validUntil date as EXPIRED.
 */
const autoExpireAllQuotations = async () => {
    try {
        const now = new Date();
        const result = await Quotation.updateMany(
            {
                status: 'SENT',
                validUntil: { $lt: now },
            },
            {
                $set: {
                    status: 'EXPIRED',
                    expiredAt: now,
                },
            }
        );

        if (result.modifiedCount > 0) {
            console.log(`[Expiry Job] Automatically expired ${result.modifiedCount} quotation(s).`);
        }
    } catch (err) {
        console.error('[Expiry Job] Error expiring quotations:', err.message);
    }
};

/**
 * Initializes the periodic background worker for quotation expiry.
 * Runs on startup, then executes every intervalMinutes (default: 30 mins).
 */
const startQuotationExpiryJob = (intervalMinutes = 30) => {
    // Run initial sync after a short delay to allow DB connection to establish
    setTimeout(() => {
        autoExpireAllQuotations();
    }, 5000);

    const intervalMs = intervalMinutes * 60 * 1000;
    const timer = setInterval(autoExpireAllQuotations, intervalMs);

    // Unref so the interval doesn't prevent Node.js from exiting during shutdown
    if (timer.unref) {
        timer.unref();
    }

    console.log(`[Expiry Job] Quotation auto-expiry scheduled every ${intervalMinutes} minutes.`);
};

module.exports = {
    autoExpireAllQuotations,
    startQuotationExpiryJob,
};
