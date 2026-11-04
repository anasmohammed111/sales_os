const mongoose = require('mongoose');
const { SCOPES } = require('../services/access/catalog');

const scope = { type: String, enum: SCOPES, default: 'own' };

/**
 * A set of permissions people in a business can be given.
 * Built-in roles carry a `key` (OWNER, SALES_MANAGER, SALESPERSON); custom
 * roles have none. The Owner role is a system role and cannot be changed.
 */
const roleSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
        key: { type: String, enum: ['OWNER', 'SALES_MANAGER', 'SALESPERSON', null], default: null },
        name: { type: String, required: true, trim: true, maxlength: 60 },
        nameLower: { type: String, required: true },
        description: { type: String, trim: true, default: '', maxlength: 240 },
        isSystem: { type: Boolean, default: false },
        permissions: { type: [String], default: [] },
        scopes: {
            leads: scope,
            followups: scope,
            quotations: scope,
            admissions: scope,
        },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

roleSchema.index({ businessId: 1, nameLower: 1 }, { unique: true });
roleSchema.index(
    { businessId: 1, key: 1 },
    { unique: true, partialFilterExpression: { key: { $type: 'string' } } }
);

roleSchema.pre('validate', function () {
    if (this.name) this.nameLower = this.name.trim().toLowerCase();
});

module.exports = mongoose.model('Role', roleSchema);
