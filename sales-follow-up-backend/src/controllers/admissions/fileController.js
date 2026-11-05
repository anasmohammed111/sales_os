const mongoose = require('mongoose');
const AdmissionDocument = require('../../models/AdmissionDocument');
const AdmissionFee = require('../../models/AdmissionFee');
const Business = require('../../models/Business');
const { isBusinessActive, suspendedResponse } = require('../../services/businessStatus');
const { getStorage } = require('../../services/storage');
const { readFileToken } = require('../../services/storage/uploads');
const { contentDisposition } = require('../../services/storage/fileValidation');

const expired = (res) =>
    res.status(401).json({ success: false, message: 'This download link has expired. Open the document again.' });

/** Resolves a token's claims to stored file metadata, or null. */
const findFile = async (claims) => {
    if (!mongoose.isValidObjectId(claims.businessId)) return null;

    if (claims.kind === 'document' && mongoose.isValidObjectId(claims.docId)) {
        const doc = await AdmissionDocument.findOne({ _id: claims.docId, businessId: claims.businessId });
        return doc?.file?.storageKey ? doc.file : null;
    }

    if (claims.kind === 'receipt' && mongoose.isValidObjectId(claims.feeId) && mongoose.isValidObjectId(claims.txId)) {
        const fee = await AdmissionFee.findOne({ _id: claims.feeId, businessId: claims.businessId });
        const receipt = fee?.transactions.id(claims.txId)?.receipt;
        return receipt?.storageKey ? receipt : null;
    }

    return null;
};

/**
 * GET /api/admissions/files/:token — streams a private file for a valid
 * 60-second token. No Authorization header: the token is the authorisation,
 * issued only after the scoped download-url check.
 */
const serveFile = async (req, res, next) => {
    try {
        const claims = readFileToken(req.params.token);
        if (!claims) return expired(res);

        // Files of a suspended or archived company are not served either
        const business = mongoose.isValidObjectId(claims.businessId)
            ? await Business.findById(claims.businessId).select('status isActive').lean()
            : null;
        if (!isBusinessActive(business)) return suspendedResponse(res);

        const file = await findFile(claims);
        if (!file) return expired(res);

        const stream = await getStorage().getStream(file.storageKey);

        res.set({
            'Content-Type': file.mimeType,
            'Content-Disposition': contentDisposition(file.originalName),
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
            'Referrer-Policy': 'no-referrer',
        });

        stream.on('error', (error) => {
            console.error('[Files] Stream error:', error.message);
            if (!res.headersSent) res.status(404).end();
            else res.destroy();
        });
        stream.pipe(res);
    } catch (error) {
        next(error);
    }
};

module.exports = { serveFile };
