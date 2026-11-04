// Seeds the SYB business, admin and team into the database in MONGO_URI.
// Safe to run again. New passwords are printed once: store them safely.
//   npm run seed
require('dotenv').config();

const mongoose = require('mongoose');
const { runMigrations } = require('../src/migrations');
const { seedSyb } = require('../src/seed/seedSyb');

const main = async () => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    const { host, name } = mongoose.connection;
    console.log(`Seeding database "${name}" on ${host}…`);

    await runMigrations();
    const result = await seedSyb();

    console.log(`\nBusiness: ${result.business.businessName} (admissions on, currency ${result.business.currency})`);
    console.log(`Universities added: ${result.universitiesAdded}`);

    if (result.created.length) {
        console.log('\nNew accounts. These passwords are shown only now:');
        console.table(result.created.map(({ name: who, email, role, password }) => ({ name: who, email, role, password })));
        console.log('Ask everyone to change their password in Settings after signing in.');
    }
    if (result.existing.length) console.log(`\nAlready existed (left unchanged): ${result.existing.join(', ')}`);
    if (result.skipped.length) console.log(`\nSkipped, email used by another business: ${result.skipped.join(', ')}`);

    await mongoose.disconnect();
};

main().catch(async (error) => {
    console.error('Seed failed:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
