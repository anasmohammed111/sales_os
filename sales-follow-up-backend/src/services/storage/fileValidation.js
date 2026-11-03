const crypto = require('crypto');

const maxUploadBytes = () => (Number(process.env.UPLOAD_MAX_MB) || 10) * 1024 * 1024;

const startsWith = (buffer, bytes, offset = 0) => bytes.every((b, i) => buffer[offset + i] === b);

/**
 * Identifies the file from its first bytes. The client's file name and MIME
 * type are never trusted. Returns null for anything not allowed.
 */
const detectFileType = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: 'pdf', mime: 'application/pdf' };
    if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' };
    if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' };
    if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
        return { ext: 'webp', mime: 'image/webp' };
    }
    return null;
};

/** Display name only: no path, no control or quote characters. */
const safeOriginalName = (name) =>
    String(name || 'document')
        .split(/[\\/]/)
        .pop()
        .replace(/[\u0000-\u001f\u007f"<>]/g, '')
        .trim()
        .slice(0, 150) || 'document';

/**
 * Content-Disposition value that is safe for any file name (RFC 6266/5987):
 * an ASCII fallback plus the UTF-8 name, so Malayalam or Czech names work.
 */
const contentDisposition = (name, type = 'inline') => {
    const fallback = String(name).replace(/[^\x20-\x7e]|["\\]/g, '_') || 'document';
    const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

/** Random storage key: <businessId>/<applicationId>/<uuid>.<ext> */
const buildStorageKey = (businessId, applicationId, ext) =>
    `${businessId}/${applicationId}/${crypto.randomUUID()}.${ext}`;

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Malware scanning hook. No scanner is available in this deployment; plug
 * ClamAV or a cloud scanning API in here. Must resolve { clean: boolean }.
 */
const scanFile = async () => ({ clean: true });

module.exports = { maxUploadBytes, detectFileType, safeOriginalName, contentDisposition, buildStorageKey, sha256, scanFile };
