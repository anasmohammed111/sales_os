const Business = require('../models/Business');
const Lead = require('../models/Leads');
const { ensureDefaultPipeline } = require('../services/pipelines');

// Gives every company its first pipeline, "Sales pipeline", with the twelve
// stages every board had before pipelines were customisable (same keys, so no
// lead's status changes), and puts each lead in it. Additive and safe to re-run.
module.exports = {
    id: '004-sales-pipelines',

    up: async () => {
        const businesses = await Business.find({}).select('_id').lean();
        for (const business of businesses) {
            const pipeline = await ensureDefaultPipeline(business._id);
            // timestamps: false, or every lead would look freshly edited to "Neglected leads"
            await Lead.updateMany(
                { businessId: business._id, pipelineId: null },
                { $set: { pipelineId: pipeline._id } },
                { timestamps: false }
            );
        }
    },
};
