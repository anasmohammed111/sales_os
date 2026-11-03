const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const DOCUMENT_STATUSES = ['MISSING', 'UPLOADED', 'VERIFIED', 'REJECTED'];

const admissionDocumentSchema = new mongoose.Schema(
    {
        businessId: { type: ObjectId, ref: 'Business', required: true },
        applicationId: { type: ObjectId, ref: 'AdmissionApplication', required: true },
        documentTypeKey: { type: String, required: true },
        title: { type: String, trim: true, default: '', maxlength: 150 },

        // Uploading never verifies: a reviewer must verify or reject
        status: { type: String, enum: DOCUMENT_STATUSES, default: 'MISSING' },

        // Private storage metadata; the storage key is never returned to clients
        file: {
            storageKey: { type: String, default: null },
            originalName: { type: String, default: '' },
            mimeType: { type: String, default: '' },
            size: { type: Number, default: 0 },
            sha256: { type: String, default: '' },
        },
        uploadedBy: { type: ObjectId, ref: 'User', default: null },
        uploadedAt: { type: Date, default: null },

        reviewedBy: { type: ObjectId, ref: 'User', default: null },
        reviewedAt: { type: Date, default: null },
        rejectionReason: { type: String, trim: true, default: '' },

        expiresAt: { type: Date, default: null },
        notes: { type: String, trim: true, default: '', maxlength: 1000 },

        createdBy: { type: ObjectId, ref: 'User', required: true },
        isArchived: { type: Boolean, default: false },
    },
    { timestamps: true }
);

admissionDocumentSchema.index({ businessId: 1, applicationId: 1, documentTypeKey: 1 });
admissionDocumentSchema.index({ businessId: 1, expiresAt: 1 });

module.exports = mongoose.model('AdmissionDocument', admissionDocumentSchema);
module.exports.DOCUMENT_STATUSES = DOCUMENT_STATUSES;
