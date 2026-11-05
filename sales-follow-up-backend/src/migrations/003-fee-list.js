const AdmissionConfig = require('../models/AdmissionConfig');
const AdmissionFee = require('../models/AdmissionFee');
const AdmissionApplication = require('../models/AdmissionApplication');
const { DEFAULT_FEES, LEGACY_PAYMENT_CATEGORIES } = require('../services/admissions/defaultConfig');
const { fitFeesToStages } = require('../services/admissions/configService');

// Fee types become service fee / student expense / university fee, and every
// business gets the default fee list (fitted to its stages; editable in
// admissions settings). Fees already on students are not changed apart from
// the type name, and no fees are added to existing students.
module.exports = {
    id: '003-fee-list',

    up: async () => {
        for (const [from, to] of Object.entries(LEGACY_PAYMENT_CATEGORIES)) {
            // Raw collection updates: the models no longer accept the old names
            await AdmissionFee.collection.updateMany({ category: from }, { $set: { category: to } });
            await AdmissionConfig.collection.updateMany(
                { 'stages.items.paymentCategory': from },
                { $set: { 'stages.$[].items.$[item].paymentCategory': to } },
                { arrayFilters: [{ 'item.paymentCategory': from }] }
            );
            await AdmissionApplication.collection.updateMany(
                { 'checklist.paymentCategory': from },
                { $set: { 'checklist.$[entry].paymentCategory': to } },
                { arrayFilters: [{ 'entry.paymentCategory': from }] }
            );
        }

        // `fees: null` matches a missing or null list
        const configs = await AdmissionConfig.find({ $or: [{ fees: null }, { fees: { $size: 0 } }] })
            .select('stages')
            .lean();
        for (const config of configs) {
            await AdmissionConfig.updateOne({ _id: config._id }, { $set: { fees: fitFeesToStages(DEFAULT_FEES, config.stages) } });
        }
    },
};
