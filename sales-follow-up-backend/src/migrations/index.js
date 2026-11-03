const Migration = require('../models/Migration');

// Ordered list. Migrations must be additive and safe to re-run.
const MIGRATIONS = [require('./001-lead-phone-digits')];

/** Applies pending migrations in order; returns the ids applied this run. */
const runMigrations = async () => {
    const applied = [];

    for (const migration of MIGRATIONS) {
        const done = await Migration.exists({ _id: migration.id });
        if (done) continue;

        await migration.up();
        await Migration.updateOne(
            { _id: migration.id },
            { $setOnInsert: { appliedAt: new Date() } },
            { upsert: true }
        );
        applied.push(migration.id);
        console.log(`[Migrations] Applied ${migration.id}`);
    }

    return applied;
};

module.exports = { runMigrations };
