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

/** Milliseconds the zone is ahead of UTC at `date`. */
const zoneOffsetMs = (date, timeZone) => {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
            .formatToParts(date)
            .map((p) => [p.type, p.value])
    );
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/** UTC instant of local midnight on the given calendar day in `timeZone`. */
const zonedStartOfDay = (year, month, day, timeZone) => {
    const guess = Date.UTC(year, month - 1, day);
    return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
};

/** [start, end] of a calendar month in `timeZone`; end is the last millisecond. */
const zonedMonthRange = (year, month, timeZone) => {
    const start = zonedStartOfDay(year, month, 1, timeZone);
    const next = month === 12 ? zonedStartOfDay(year + 1, 1, 1, timeZone) : zonedStartOfDay(year, month + 1, 1, timeZone);
    return [start, new Date(next.getTime() - 1)];
};

module.exports = { isValidTimeZone, formatDateTime, formatDate, zoneOffsetMs, zonedStartOfDay, zonedMonthRange };
