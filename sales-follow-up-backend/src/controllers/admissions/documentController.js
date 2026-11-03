const mongoose = require('mongoose');
const AdmissionDocument = require('../../models/AdmissionDocument');
const { findApplicationInScope } = require('../../services/admissions/access');
const { toDate } = require('../../services/admissions/filters');
const { logActivity } = require('../../services/admissions/activity');
const reminders = require('../../services/admissions/reminders');
const { storeUpload, removeStored, issueFileLink } = require('../../services/storage/uploads');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const person = (value) => (value?.name ? { id: value._id, name: value.name } : null);

// Never expose the storage key
const serializeDocument = (doc) => ({
    id: doc._id,
    applicationId: doc.applicationId,
    documentTypeKey: doc.documentTypeKey,
    title: doc.title,
    status: doc.status,
    file: {
        hasFile: Boolean(doc.file?.storageKey),
        originalName: doc.file?.originalName || '',
        mimeType: doc.file?.mimeType || '',
        size: doc.file?.size || 0,
    },
    uploadedBy: person(doc.uploadedBy),
    uploadedAt: doc.uploadedAt,
    reviewedBy: person(doc.reviewedBy),
    reviewedAt: doc.reviewedAt,
    rejectionReason: doc.rejectionReason,
    expiresAt: doc.expiresAt,
    notes: doc.notes,
    createdAt: doc.createdAt,
});

const POPULATE = [
    { path: 'uploadedBy', select: 'name' },
    { path: 'reviewedBy', select: 'name' },
];

/** Loads a document whose application is in the user's scope. */
const findDocumentInScope = async (req, id) => {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await AdmissionDocument.findOne({ _id: id, businessId: req.user.businessId, isArchived: { $ne: true } });
    if (!doc) return null;
    const application = await findApplicationInScope(req, doc.applicationId);
    return application ? { doc, application } : null;
};

const respond = async (res, doc, status = 200) => {
    await doc.populate(POPULATE);
    return res.status(status).json({ success: true, data: serializeDocument(doc) });
};

const parseExpiry = (value) => {
    if (value === undefined) return { skip: true };
    if (value === null || value === '') return { value: null };
    const date = toDate(value);
    return date ? { value: date } : { error: 'Invalid expiry date' };
};

const listDocuments = async (req, res, next) => {
    try {
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const documents = await AdmissionDocument.find({
            businessId: req.user.businessId,
            applicationId: application._id,
            isArchived: { $ne: true },
        })
            .sort({ createdAt: 1 })
            .populate(POPULATE);

        const usedKeys = new Set(documents.map((d) => d.documentTypeKey));
        const types = req.admissionsConfig.documentTypes.filter((t) => !t.isArchived || usedKeys.has(t.key));

        return res.json({ success: true, data: { types, documents: documents.map(serializeDocument) } });
    } catch (error) {
        next(error);
    }
};

const createDocument = async (req, res, next) => {
    try {
        const { documentTypeKey, title, expiresAt, notes } = req.body || {};
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const type = req.admissionsConfig.documentTypes.find((t) => t.key === documentTypeKey && !t.isArchived);
        if (!type) return fail(res, 400, 'Choose a valid document type');

        const expiry = parseExpiry(expiresAt);
        if (expiry.error) return fail(res, 400, expiry.error);

        const doc = await AdmissionDocument.create({
            businessId: req.user.businessId,
            applicationId: application._id,
            documentTypeKey,
            title: typeof title === 'string' ? title.trim().slice(0, 150) : '',
            notes: typeof notes === 'string' ? notes.trim().slice(0, 1000) : '',
            expiresAt: expiry.skip ? null : expiry.value,
            createdBy: req.user.userId,
        });

        await reminders.syncRemindersForApplication(application._id);
        await logActivity({ req, application, type: 'DOCUMENT_ADDED', message: `${type.name} added to documents` });

        return respond(res, doc, 201);
    } catch (error) {
        next(error);
    }
};

const updateDocument = async (req, res, next) => {
    try {
        const found = await findDocumentInScope(req, req.params.docId);
        if (!found) return fail(res, 404, 'Document not found');
        const { doc, application } = found;
        const { title, notes, expiresAt } = req.body || {};

        const expiry = parseExpiry(expiresAt);
        if (expiry.error) return fail(res, 400, expiry.error);
        if (!expiry.skip) doc.expiresAt = expiry.value;
        if (typeof title === 'string') doc.title = title.trim().slice(0, 150);
        if (typeof notes === 'string') doc.notes = notes.trim().slice(0, 1000);

        await doc.save();
        await reminders.syncRemindersForApplication(application._id);
        return respond(res, doc);
    } catch (error) {
        next(error);
    }
};

const uploadDocumentFile = async (req, res, next) => {
    try {
        const found = await findDocumentInScope(req, req.params.docId);
        if (!found) return fail(res, 404, 'Document not found');
        const { doc, application } = found;

        const stored = await storeUpload({ file: req.file, businessId: req.user.businessId, applicationId: application._id });
        if (stored.error) return fail(res, stored.status, stored.error);

        const replacedKey = doc.file?.storageKey;
        doc.file = stored.file;
        doc.status = 'UPLOADED';
        doc.uploadedBy = req.user.userId;
        doc.uploadedAt = new Date();
        // A new file always needs a fresh review
        doc.reviewedBy = null;
        doc.reviewedAt = null;
        doc.rejectionReason = '';
        await doc.save();
        await removeStored(replacedKey);

        await logActivity({
            req,
            application,
            type: 'DOCUMENT_UPLOADED',
            message: `File uploaded for ${doc.title || doc.documentTypeKey}: ${stored.file.originalName}`,
            meta: { documentId: doc._id },
        });

        return respond(res, doc);
    } catch (error) {
        next(error);
    }
};

const reviewDocument = async (req, res, next) => {
    try {
        const { status, reason } = req.body || {};
        const found = await findDocumentInScope(req, req.params.docId);
        if (!found) return fail(res, 404, 'Document not found');
        const { doc, application } = found;

        if (!['VERIFIED', 'REJECTED'].includes(status)) return fail(res, 400, 'Status must be VERIFIED or REJECTED');
        const trimmed = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
        if (status === 'REJECTED' && trimmed.length < 3) return fail(res, 400, 'Give a reason for rejecting the document');

        doc.status = status;
        doc.reviewedBy = req.user.userId;
        doc.reviewedAt = new Date();
        doc.rejectionReason = status === 'REJECTED' ? trimmed : '';
        await doc.save();
        await reminders.syncRemindersForApplication(application._id);

        await logActivity({
            req,
            application,
            type: 'DOCUMENT_REVIEWED',
            message: `${doc.title || doc.documentTypeKey} ${status === 'VERIFIED' ? 'verified' : `rejected: ${trimmed}`}`,
            meta: { documentId: doc._id, status },
        });

        return respond(res, doc);
    } catch (error) {
        next(error);
    }
};

const getDownloadUrl = async (req, res, next) => {
    try {
        const found = await findDocumentInScope(req, req.params.docId);
        if (!found) return fail(res, 404, 'Document not found');
        const { doc } = found;
        if (!doc.file?.storageKey) return fail(res, 404, 'No file has been uploaded for this document');

        const link = await issueFileLink({
            claims: { kind: 'document', docId: String(doc._id), businessId: String(doc.businessId) },
            storageKey: doc.file.storageKey,
            filename: doc.file.originalName,
            mimeType: doc.file.mimeType,
        });

        return res.json({ success: true, data: link });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    listDocuments,
    createDocument,
    updateDocument,
    uploadDocumentFile,
    reviewDocument,
    getDownloadUrl,
};
