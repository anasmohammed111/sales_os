// Timestamps are stored in UTC and shown in the module's configured timezone.

const isValidTimeZone = (tz) => {
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
};

const formatDateTime = (date, timeZone = 'Asia/Kolkata') =>
    date
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(date))
        : '';

const formatDate = (date, timeZone = 'Asia/Kolkata') =>
    date ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(new Date(date)) : '';

module.exports = { isValidTimeZone, formatDateTime, formatDate };
