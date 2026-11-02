const mongoose = require('mongoose');

const SUPPORTED_CURRENCIES = [
    'INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'CAD', 'AUD', 'SGD', 'JPY', 'CNY', 'CHF', 'NZD', 'QAR', 'KWD', 'BHD', 'OMR'
];

const quotationItemSchema = new mongoose.Schema(
    {
        itemName: {
            type: String,
            required: [true, 'Item name is required'],
            trim: true,
            maxlength: [200, 'Item name cannot exceed 200 characters'],
        },

        description: {
            type: String,
            trim: true,
            default: '',
            maxlength: [1000, 'Item description cannot exceed 1000 characters'],
        },

        quantity: {
            type: Number,
            required: [true, 'Quantity is required'],
            min: [0.001, 'Quantity must be at least 0.001'],
        },

        unit: {
            type: String,
            trim: true,
            default: 'PCS',
            maxlength: [30, 'Unit cannot exceed 30 characters'],
        },

        unitPrice: {
            type: Number,
            required: [true, 'Unit price is required'],
            min: [0, 'Unit price cannot be negative'],
        },

        discount: {
            type: Number,
            default: 0,
            min: [0, 'Discount cannot be negative'],
        },

        taxRate: {
            type: Number,
            default: 0,
            min: [0, 'Tax rate cannot be negative'],
            max: [100, 'Tax rate cannot exceed 100%'],
        },

        taxAmount: {
            type: Number,
            default: 0,
            min: [0, 'Tax amount cannot be negative'],
        },

        amount: {
            type: Number,
            required: [true, 'Item amount is required'],
            min: [0, 'Item amount cannot be negative'],
        },
    },
    { _id: true }
);

const quotationSchema = new mongoose.Schema(
    {
        businessId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Business',
            required: [true, 'Business ID is required'],
            index: true,
        },

        leadId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Lead',
            required: [true, 'Lead ID is required'],
            index: true,
        },

        quotationNumber: {
            type: String,
            required: [true, 'Quotation number is required'],
            trim: true,
        },

        customer: {
            name: {
                type: String,
                required: [true, 'Customer name is required'],
                trim: true,
                maxlength: [120, 'Customer name cannot exceed 120 characters'],
            },
            companyName: {
                type: String,
                trim: true,
                default: '',
                maxlength: [150, 'Company name cannot exceed 150 characters'],
            },
            email: {
                type: String,
                trim: true,
                lowercase: true,
                default: '',
            },
            phone: {
                type: String,
                trim: true,
                default: '',
                maxlength: [30, 'Phone cannot exceed 30 characters'],
            },
            billingAddress: {
                type: String,
                trim: true,
                default: '',
                maxlength: [500, 'Billing address cannot exceed 500 characters'],
            },
        },

        quotationDate: {
            type: Date,
            required: [true, 'Quotation date is required'],
        },

        validUntil: {
            type: Date,
            required: [true, 'Quotation expiry date (validUntil) is required'],
            validate: {
                validator: function (value) {
                    if (!this.quotationDate || !value) return true;
                    return new Date(value) > new Date(this.quotationDate);
                },
                message: 'Expiry date (validUntil) must be strictly after the quotation date',
            },
        },

        subject: {
            type: String,
            trim: true,
            default: '',
            maxlength: [200, 'Subject cannot exceed 200 characters'],
        },

        items: {
            type: [quotationItemSchema],
            required: [true, 'Quotation items are required'],
            validate: [
                {
                    validator: (items) => Array.isArray(items) && items.length >= 1,
                    message: 'At least one quotation item is required',
                },
                {
                    validator: (items) => Array.isArray(items) && items.length <= 100,
                    message: 'Maximum 100 quotation items are allowed',
                },
            ],
        },

        subtotal: {
            type: Number,
            required: [true, 'Subtotal is required'],
            min: [0, 'Subtotal cannot be negative'],
        },

        discount: {
            type: Number,
            default: 0,
            min: [0, 'Overall discount cannot be negative'],
        },

        taxAmount: {
            type: Number,
            default: 0,
            min: [0, 'Tax amount cannot be negative'],
        },

        grandTotal: {
            type: Number,
            required: [true, 'Grand total is required'],
            min: [0, 'Grand total cannot be negative'],
        },

        currency: {
            type: String,
            enum: {
                values: SUPPORTED_CURRENCIES,
                message: '{VALUE} is not a supported currency code',
            },
            default: 'INR',
            uppercase: true,
        },

        status: {
            type: String,
            enum: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
            default: 'DRAFT',
            index: true,
        },

        termsAndConditions: {
            type: String,
            trim: true,
            default: '',
            maxlength: [5000, 'Terms and conditions cannot exceed 5000 characters'],
        },

        customerNotes: {
            type: String,
            trim: true,
            default: '',
            maxlength: [2000, 'Customer notes cannot exceed 2000 characters'],
        },

        internalNotes: {
            type: String,
            trim: true,
            default: '',
            maxlength: [2000, 'Internal notes cannot exceed 2000 characters'],
        },

        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Assigned user is required'],
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Created by user is required'],
        },

        sentAt: {
            type: Date,
            default: null,
        },

        acceptedAt: {
            type: Date,
            default: null,
        },

        rejectedAt: {
            type: Date,
            default: null,
        },

        expiredAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// A quotation number must be unique within a business.
quotationSchema.index(
    { businessId: 1, quotationNumber: 1 },
    { unique: true }
);

// Compound indexes for performant scoped filtering and sorting.
quotationSchema.index({ businessId: 1, status: 1, createdAt: -1 });
quotationSchema.index({ businessId: 1, leadId: 1 });
quotationSchema.index({ businessId: 1, assignedTo: 1, createdAt: -1 });

module.exports = mongoose.model('Quotation', quotationSchema);
module.exports.SUPPORTED_CURRENCIES = SUPPORTED_CURRENCIES;
