const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        businessId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Business',
            required: true,
            index: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },

        phone: {
            type: String,
            trim: true,
        },

        password: {
            type: String,
            required: function () {
                return !this.googleId;
            },
            default: null,
        },

        // Left unset (not null) for password-only users so the sparse unique index skips them
        googleId: {
            type: String,
        },

        // Built-in role type, kept for compatibility. What a person may do comes
        // from roleId (see services/access); custom roles store 'SALESPERSON' here.
        role: {
            type: String,
            enum: ['OWNER', 'SALES_MANAGER', 'SALESPERSON'],
            default: 'SALESPERSON',
        },

        // The role that decides this person's permissions and data scope
        roleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Role',
            default: null,
        },

        managerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        resetPasswordToken: {
            type: String,
            default: null,
        },

        resetPasswordExpires: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

userSchema.index(
    { email: 1 },
    { unique: true }
);

userSchema.index(
    { googleId: 1 },
    { unique: true, sparse: true }
);

module.exports = mongoose.model('User', userSchema);