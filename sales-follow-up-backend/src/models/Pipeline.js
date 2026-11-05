const mongoose = require('mongoose');

// What a stage means, whatever the company calls it: the dashboard, reports and
// the Admissions hand-off read the kind, never the name.
const STAGE_KINDS = ['OPEN', 'WON', 'LOST', 'PARKED', 'ADMISSIONS'];
const STAGE_KEY = /^[A-Z0-9_]{1,40}$/;
const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

const stageSchema = new mongoose.Schema(
    {
        // Stable id a lead's status points at; renaming a stage never changes it
        key: { type: String, required: true, match: STAGE_KEY },
        name: { type: String, required: true, trim: true, maxlength: 60 },
        color: { type: String, required: true, match: HEX_COLOUR },
        kind: { type: String, required: true, enum: STAGE_KINDS },
        order: { type: Number, required: true },
        // Removed stages stay so old history keeps its labels; their keys are never reused
        isArchived: { type: Boolean, default: false },
    },
    { _id: false }
);

// A company's sales pipeline. Every company has at least one, and exactly one default.
const pipelineSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
        name: { type: String, required: true, trim: true, maxlength: 60 },
        isDefault: { type: Boolean, default: false },
        order: { type: Number, default: 0 },
        isArchived: { type: Boolean, default: false },
        stages: { type: [stageSchema], default: [] },
    },
    { timestamps: true }
);

// One default per company, so two requests creating the first pipeline at once can't both win
pipelineSchema.index(
    { businessId: 1 },
    { unique: true, partialFilterExpression: { isDefault: true, isArchived: false }, name: 'one_default_per_business' }
);

module.exports = mongoose.model('Pipeline', pipelineSchema);
module.exports.STAGE_KINDS = STAGE_KINDS;
module.exports.STAGE_KEY = STAGE_KEY;
module.exports.HEX_COLOUR = HEX_COLOUR;
