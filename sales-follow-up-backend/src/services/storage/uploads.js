const jwt = require('jsonwebtoken');
const multer = require('multer');
const { getStorage } = require('./index');
const { maxUploadBytes, detectFileType, safeOriginalName, buildStorageKey, sha256, scanFile } = require('./fileValidation');

const LINK_TTL_SECONDS = 60;
const FILE_TOKEN_AUDIENCE = 'admissions-file';

/** Multer for one in-memory file field named "file", with friendly errors. */
const uploadSingle = (req, res, next) => {
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxUploadBytes(), files: 1 },
        // Browsers send UTF-8 file names; the default (latin1) garbles non-English names
        defParamCharset: 'utf8',
    }).single('file');

    upload(req, res, (error) => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                message: `File is too large. The limit is ${Math.round(maxUploadBytes() / 1024 / 1024)} MB.`,
            });
        }
        return res.status(400).json({ success: false, message: 'Upload one file in the "file" field' });
    });
};

/**
 * Validates and stores an uploaded file privately.
 * Returns { file } metadata or { status, error }.
 */
const storeUpload = async ({ file, businessId, applicationId }) => {
    if (!file?.buffer?.length) return { status: 400, error: 'Choose a file to upload' };

    const type = detectFileType(file.buffer);
    if (!type) return { status: 400, error: 'Only PDF, JPG, PNG or WEBP files can be uploaded' };

    const scan = await scanFile(file.buffer);
    if (!scan.clean) return { status: 400, error: 'This file failed the security scan' };

    const storageKey = buildStorageKey(businessId, applicationId, type.ext);
    await getStorage().put(storageKey, file.buffer, type.mime);

    return {
        file: {
            storageKey,
            originalName: safeOriginalName(file.originalname),
            mimeType: type.mime,
            size: file.buffer.length,
            sha256: sha256(file.buffer),
        },
    };
};

/** Best-effort removal of a replaced file; never fails the request. */
const removeStored = async (storageKey) => {
    if (!storageKey) return;
    await getStorage().remove(storageKey).catch((error) => {
        console.error('[Storage] Could not remove replaced file:', error.message);
    });
};

/**
 * A link valid for 60 seconds. S3/R2: a presigned URL. Local storage: an API
 * path carrying a signed token, served by GET /api/admissions/files/:token.
 */
const issueFileLink = async ({ claims, storageKey, filename, mimeType }) => {
    const signed = await getStorage().signedUrl(storageKey, { filename, mimeType, ttlSeconds: LINK_TTL_SECONDS });
    if (signed) return { url: signed, expiresInSeconds: LINK_TTL_SECONDS };

    const token = jwt.sign(claims, process.env.JWT_SECRET, {
        expiresIn: LINK_TTL_SECONDS,
        audience: FILE_TOKEN_AUDIENCE,
    });
    return { url: `/api/admissions/files/${token}`, expiresInSeconds: LINK_TTL_SECONDS };
};

/** Verifies a file token; returns its claims or null. */
const readFileToken = (token) => {
    try {
        return jwt.verify(token, process.env.JWT_SECRET, { audience: FILE_TOKEN_AUDIENCE });
    } catch {
        return null;
    }
};

module.exports = { uploadSingle, storeUpload, removeStored, issueFileLink, readFileToken, LINK_TTL_SECONDS };
