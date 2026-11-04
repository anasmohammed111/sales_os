const Business = require('../models/Business');
const { backfillUserRoles } = require('../services/access');

// Gives every business the three built-in roles (Owner, Sales manager,
// Salesperson) and links each existing person to the one matching their role
// type, so everyone keeps exactly the access they had before roles became
// customisable. Additive only: never changes a role someone already has.
module.exports = {
    id: '002-default-roles',

    up: async () => {
        const businesses = await Business.find({}).select('_id').lean();
        for (const business of businesses) {
            await backfillUserRoles(business._id);
        }
    },
};
