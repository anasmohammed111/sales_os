
const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema(
    {
        businessId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Business',
            required: true,
        },

        leadId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Lead',
            required: true,
        },

        // Set when the follow-up belongs to an admissions application
        applicationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'AdmissionApplication',
            default: null,
        },

        title: {
            type: String,
            trim: true,
            default: '',
            maxlength: 200,
        },

        priority: {
            type: String,
            enum: ['LOW', 'MEDIUM', 'HIGH'],
            default: 'MEDIUM',
        },

        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        type: {
            type: String,
            enum: [
                'CALL',
                'WHATSAPP',
                'EMAIL',
                'MEETING',
                'OTHER',
                // Admissions task types
                'TASK',
                'DOCUMENT',
                'PAYMENT',
                'EXAM',
                'INTERVIEW',
                'VISA',
            ],
            default: 'OTHER',
        },

        scheduledAt: {
            type: Date,
            required: true,
        },

        status: {
            type: String,
            enum: [
                'PENDING',
                'COMPLETED',
                'CANCELLED',
            ],
            default: 'PENDING',
        },

        notes: {
            type: String,
            trim: true,
            default: '',
        },

        outcome: {
            type: String,
            trim: true,
            default: '',
        },

        completedAt: {
            type: Date,
            default: null,
        },

        isArchived: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

// Business follow-up lists filtered by status and scheduled date
followUpSchema.index({
    businessId: 1,
    status: 1,
    scheduledAt: 1,
});

// Follow-up history for a specific lead, newest first
followUpSchema.index({
    businessId: 1,
    leadId: 1,
    scheduledAt: -1,
});

// Admissions task lists per assignee and per application
followUpSchema.index({ businessId: 1, assignedTo: 1, status: 1, scheduledAt: 1 });
followUpSchema.index({ businessId: 1, applicationId: 1, status: 1, scheduledAt: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
