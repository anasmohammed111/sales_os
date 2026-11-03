const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema(
    {
        businessName: {
            type: String,
            required: [true, 'Business name is required'],
            trim: true,
            maxlength: 100,
        },

        email: {
            type: String,
            required: [true, 'Business email is required'],
            lowercase: true,
            trim: true,
        },

        phone: {
            type: String,
            trim: true,
            default: '',
        },

        address: {
            type: String,
            trim: true,
            default: '',
        },

        gstin: {
            type: String,
            trim: true,
            uppercase: true,
            default: '',
        },

        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        // Optional modules switched on per business (see scripts/admissions-enable.js)
        features: {
            admissions: {
                type: Boolean,
                default: false,
            },
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Business', businessSchema);