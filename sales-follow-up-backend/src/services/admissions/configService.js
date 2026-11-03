const AdmissionConfig = require('../../models/AdmissionConfig');
const {
    DEFAULT_STAGES,
    DEFAULT_DOCUMENT_TYPES,
    DEFAULT_LEAD_SOURCES,
    DEFAULT_REMINDERS,
    DEFAULT_TIMEZONE,
} = require('./defaultConfig');

const buildDefaultConfig = (businessId) => ({
    businessId,
    stages: DEFAULT_STAGES.map((stage, index) => ({ ...stage, order: index + 1 })),
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
    buildDefaultConfig,
    ensureConfig,
    getActiveStages,
    getAllStages,
    findStage,
};
