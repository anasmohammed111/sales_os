const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema(
    {
        // Which business owns this lead?
        businessId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Business',
            required: true,
            index: true,
        },

        // Customer contact information
        customerName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },

        companyName: {
            type: String,
            trim: true,
            default: '',
            maxlength: 150,
        },

        email: {
            type: String,
            lowercase: true,
            trim: true,
            default: '',
        },

        phone: {
            type: String,
            trim: true,
            default: '',
        },

        // Where did the enquiry come from?
        source: {
            type: String,
            enum: [
                'WHATSAPP',
                'PHONE',
                'EMAIL',
                'WEBSITE',
                'WALK_IN',
                'REFERRAL',
                'OTHER',
            ],
            default: 'OTHER',
        },

        interestedIn: {
            type: String,
            trim: true,
            default: '',
        },

        // Estimated value of the potential sale
        estimatedValue: {
            type: Number,
            min: 0,
            default: 0,
        },

        // Current sales stage
        status: {
            type: String,
            enum: [
                'NEW',
                'CONTACTED',
                'QUALIFIED',
                'QUOTATION_SENT',
                'NEGOTIATION',
                'WON',
                'LOST',
            ],
            default: 'NEW',
            index: true,
        },

        priority: {
            type: String,
            enum: ['LOW', 'MEDIUM', 'HIGH'],
            default: 'MEDIUM',
        },

        // The team member responsible for this lead
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        // The user who created the lead
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        // Next planned follow-up
        nextFollowUpAt: {
            type: Date,
            default: null,
        },

        notes: {
            type: String,
            trim: true,
            default: '',
        },

        lostReason: {
            type: String,
            trim: true,
            default: '',
        },

        // Hide archived leads without permanently deleting them
        isArchived: {
            type: Boolean,
            default: false,
        },

        // History of pipeline status changes for auditing and tracking
        statusHistory: [
            {
                fromStatus: {
                    type: String,
                    required: true,
                },
                toStatus: {
                    type: String,
                    required: true,
                },
                changedBy: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User',
                    required: true,
                },
                changedAt: {
                    type: Date,
                    default: Date.now,
                },
                reason: {
                    type: String,
                    trim: true,
                    default: '',
                },
            },
        ],
    },
    {
        timestamps: true,
    }
);

// Helps filter leads by business, status and creation date
leadSchema.index({
    businessId: 1,
    status: 1,
    createdAt: -1,
});

// Helps managers find leads assigned to team members
leadSchema.index({
    businessId: 1,
    assignedTo: 1,
    status: 1,
});

// Helps find leads that need follow-up
leadSchema.index({
    businessId: 1,
    nextFollowUpAt: 1,
});

module.exports = mongoose.model('Lead', leadSchema);