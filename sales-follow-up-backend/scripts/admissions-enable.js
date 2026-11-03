// Turns on the SYB admissions module for one business and seeds its default
// configuration. Usage: npm run admissions:enable -- owner@example.com
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../src/models/User');
const Business = require('../src/models/Business');
const { ensureConfig } = require('../src/services/admissions/configService');
const { runMigrations } = require('../src/migrations');

const main = async () => {
    const email = (process.argv[2] || '').trim().toLowerCase();
    if (!email) {
        console.error('Usage: npm run admissions:enable -- <owner-email>');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    await runMigrations();

    const owner = await User.findOne({ email, role: 'OWNER' });
    if (!owner) {
        console.error(`No business owner found with email ${email}`);
        process.exit(1);
    }

    const business = await Business.findByIdAndUpdate(
        owner.businessId,
        { $set: { 'features.admissions': true } },
        { new: true }
    );
    const config = await ensureConfig(business._id);

    console.log(`Admissions enabled for "${business.businessName}" (${config.stages.length} stages configured).`);
    await mongoose.disconnect();
};

main().catch(async (error) => {
    console.error('Failed to enable admissions:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
