// Private document storage. STORAGE_DRIVER=local (default) or s3.
const getStorage = () =>
    process.env.STORAGE_DRIVER === 's3' ? require('./s3Driver') : require('./localDriver');

module.exports = { getStorage };
