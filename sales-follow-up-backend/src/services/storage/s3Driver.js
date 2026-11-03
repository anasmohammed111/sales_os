const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { contentDisposition } = require('./fileValidation');

// Private S3-compatible bucket (Cloudflare R2 recommended). The bucket must
// NOT allow public access; files are only reachable through signed links.
let client = null;

const bucket = () => {
    if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET is not configured');
    return process.env.S3_BUCKET;
};

const getClient = () => {
    if (!client) {
        client = new S3Client({
            region: process.env.S3_REGION || 'auto',
            endpoint: process.env.S3_ENDPOINT || undefined,
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            },
        });
    }
    return client;
};

module.exports = {
    name: 's3',

    put: async (key, buffer, mimeType) => {
        await getClient().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buffer, ContentType: mimeType }));
    },

    getStream: async (key) => {
        const result = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
        return result.Body;
    },

    remove: async (key) => {
        await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    },

    signedUrl: async (key, { filename, mimeType, ttlSeconds }) =>
        getSignedUrl(
            getClient(),
            new GetObjectCommand({
                Bucket: bucket(),
                Key: key,
                ResponseContentType: mimeType,
                ResponseContentDisposition: contentDisposition(filename),
            }),
            { expiresIn: ttlSeconds }
        ),
};
