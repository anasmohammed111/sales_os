const Lead = require('../models/Leads');
const { normalizePhone } = require('../services/admissions/phone');

// Backfills Lead.phoneDigits for leads created before duplicate detection existed.
// Additive only: never changes the original phone value.
module.exports = {
    id: '001-lead-phone-digits',

    up: async () => {
        const cursor = Lead.collection.find(
            { phoneDigits: { $exists: false } },
            { projection: { _id: 1, phone: 1 } }
        );

        let ops = [];
        for await (const lead of cursor) {
            ops.push({
                updateOne: {
                    filter: { _id: lead._id },
                    update: { $set: { phoneDigits: normalizePhone(lead.phone) } },
                },
            });
            if (ops.length === 500) {
                await Lead.collection.bulkWrite(ops);
                ops = [];
            }
        }
        if (ops.length) await Lead.collection.bulkWrite(ops);
    },
};
