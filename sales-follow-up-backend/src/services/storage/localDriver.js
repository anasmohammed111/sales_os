const fs = require('fs');
const path = require('path');

// Private folder on the server's disk, outside any public web root.
// Good for development. Render's disk is wiped on deploy: use the s3 driver there.
const root = () => path.resolve(process.env.STORAGE_LOCAL_DIR || path.join(__dirname, '../../../storage/private'));

const KEY_PATTERN = /^[a-f0-9]{24}\/[a-f0-9]{24}\/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/;

const resolveKey = (key) => {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    return path.join(root(), ...key.split('/'));
};

module.exports = {
    name: 'local',

    put: async (key, buffer) => {
        const target = resolveKey(key);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
    },

    getStream: async (key) => fs.createReadStream(resolveKey(key)),

    remove: async (key) => {
        await fs.promises.rm(resolveKey(key), { force: true });
    },

    // No native signed URLs: the API issues its own short-lived token link
    signedUrl: async () => null,
};
