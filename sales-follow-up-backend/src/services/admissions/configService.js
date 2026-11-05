const AdmissionConfig = require('../../models/AdmissionConfig');
const {
    DEFAULT_STAGES,
    DEFAULT_FEES,
    DEFAULT_DOCUMENT_TYPES,
    DEFAULT_LEAD_SOURCES,
    DEFAULT_REMINDERS,
    DEFAULT_TIMEZONE,
} = require('./defaultConfig');

/**
 * Fee-list entries that fit the given stages: drops fees whose stage is
 * missing, and item links to items the stage doesn't have.
 */
const fitFeesToStages = (fees, stages) =>
    fees.flatMap((fee) => {
        const stage = stages.find((s) => s.key === fee.stageKey);
        if (!stage) return [];
        const has = (key) => stage.items.some((i) => i.key === key);
        const fitted = { ...fee };
        if (fitted.trigger === 'ITEM_COMPLETED' && !has(fitted.triggerItemKey)) {
            fitted.trigger = 'STAGE_ENTERED';
            fitted.triggerItemKey = null;
        }
        if (fitted.hold === 'ITEM' && !has(fitted.holdItemKey)) {
            fitted.hold = 'NONE';
            fitted.holdItemKey = null;
            fitted.autoCompleteItem = false;
        }
        return [fitted];
    });

const buildDefaultConfig = (businessId) => ({
    businessId,
    stages: DEFAULT_STAGES.map((stage, index) => ({ ...stage, order: index + 1 })),
    fees: fitFeesToStages(DEFAULT_FEES, DEFAULT_STAGES),
    documentTypes: DEFAULT_DOCUMENT_TYPES,
    leadSources: DEFAULT_LEAD_SOURCES,
    reminderDefaults: DEFAULT_REMINDERS,
    timezone: DEFAULT_TIMEZONE,
});

/** Returns the business's admissions config, creating the default once. */
const ensureConfig = async (businessId) => {
    const existing = await AdmissionConfig.findOne({ businessId });
    if (existing) return existing;

    try {
        return await AdmissionConfig.create(buildDefaultConfig(businessId));
    } catch (error) {
        // Another request created it first
        if (error.code === 11000) return AdmissionConfig.findOne({ businessId });
        throw error;
    }
};

const sortStages = (stages) => [...stages].sort((a, b) => a.order - b.order);

/** Non-archived stages in pipeline order. */
const getActiveStages = (config) => sortStages(config.stages.filter((s) => !s.isArchived));

/** All stages (archived included) in pipeline order. */
const getAllStages = (config) => sortStages(config.stages);

const findStage = (config, key) => config.stages.find((s) => s.key === key) || null;

module.exports = {
    fitFeesToStages,
    buildDefaultConfig,
    ensureConfig,
    getActiveStages,
    getAllStages,
    findStage,
};
