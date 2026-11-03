const University = require('../../models/University');
const { getAllStages } = require('../../services/admissions/configService');
const { isAdmin, getAssignableCounsellors } = require('../../services/admissions/access');

/** Configuration as clients see it: stages in order, archived entries flagged. */
const serializeConfig = (config) => ({
    stages: getAllStages(config).map((stage) => ({
        key: stage.key,
        name: stage.name,
        order: stage.order,
        stuckThresholdDays: stage.stuckThresholdDays,
        gate: stage.gate,
        isArchived: stage.isArchived,
        items: stage.items.map((item) => ({
            key: item.key,
            label: item.label,
            required: item.required,
            condition: item.condition,
            rule: item.rule,
            paymentCategory: item.paymentCategory,
            isArchived: item.isArchived,
        })),
    })),
    documentTypes: config.documentTypes,
    leadSources: config.leadSources,
    reminderDefaults: config.reminderDefaults,
    timezone: config.timezone,
});

const getContext = async (req, res, next) => {
    try {
        const [counsellors, universities] = await Promise.all([
            getAssignableCounsellors(req),
            University.find({ businessId: req.user.businessId }).sort({ name: 1 }),
        ]);

        return res.json({
            success: true,
            data: {
                enabled: true,
                role: req.user.role,
                isAdmin: isAdmin(req),
                userId: req.user.userId,
                businessName: req.business.businessName,
                config: serializeConfig(req.admissionsConfig),
                counsellors,
                universities,
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getContext, serializeConfig };
