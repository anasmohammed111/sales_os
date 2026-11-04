const mongoose = require('mongoose');
const { normalizePhone } = require('../services/admissions/phone');

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

        // Digits-only phone for duplicate detection (maintained by hooks below)
        phoneDigits: {
            type: String,
            default: '',
        },

        whatsapp: {
            type: String,
            trim: true,
            default: '',
            maxlength: 30,
        },

        city: {
            type: String,
            trim: true,
            default: '',
            maxlength: 100,
        },

        // Where did the enquiry come from?
        source: {
            type: String,
            enum: [
                'INSTAGRAM',
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
                'ADMISSIONS',
                'ON_HOLD',
                'CLOSED',
                'NO_LONGER_REQUIRED',
                'UNRESPONSIVE',
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

// Duplicate-student warnings match on normalised email and phone
leadSchema.index({ businessId: 1, email: 1 });
leadSchema.index({ businessId: 1, phoneDigits: 1 });

leadSchema.pre('save', function () {
    if (this.isNew || this.isModified('phone')) {
        this.phoneDigits = normalizePhone(this.phone);
    }
});

// Admissions applications keep a searchable copy of the student's contact details
const syncAdmissionSnapshots = async (lead) => {
    const AdmissionApplication = mongoose.models.AdmissionApplication;
    if (!lead?._id || !AdmissionApplication) return;

    await AdmissionApplication.updateMany(
        { studentId: lead._id },
        {
            $set: {
                student: {
                    name: lead.customerName || '',
                    email: lead.email || '',
                    phone: lead.phone || '',
                    phoneDigits: lead.phoneDigits || normalizePhone(lead.phone),
                    whatsapp: lead.whatsapp || '',
                    city: lead.city || '',
                },
            },
        }
    );
};

leadSchema.post('save', async function (doc) {
    if (!doc.wasNew) await syncAdmissionSnapshots(doc);
});

leadSchema.post('findOneAndUpdate', async function (doc) {
    if (!doc) return;
    // Callers may not ask for the updated document, so read it fresh
    await syncAdmissionSnapshots(await this.model.findById(doc._id));
});

leadSchema.pre('save', function () {
    this.wasNew = this.isNew;
});

leadSchema.pre('findOneAndUpdate', function () {
    const update = this.getUpdate() || {};
    const phone = update.$set?.phone ?? update.phone;
    if (phone !== undefined) {
        this.setUpdate({
            ...update,
            $set: { ...(update.$set || {}), phoneDigits: normalizePhone(phone) },
        });
    }
});

module.exports = mongoose.model('Lead', leadSchema);