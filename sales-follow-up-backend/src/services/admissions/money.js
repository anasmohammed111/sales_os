// Money is stored as integer minor units (paise / cents) to avoid float errors.

const CURRENCIES = ['INR', 'EUR', 'CZK', 'USD'];
const MAX_MINOR = 100000000000; // 1,000,000,000.00

const FORMAT_MESSAGE = 'Enter an amount like 1500 or 1500.50 (numbers only, no commas)';

/** Parses a user-entered amount into minor units. */
const parseMoney = (input) => {
    let text;

    if (typeof input === 'number') {
        if (!Number.isFinite(input)) return { ok: false, message: FORMAT_MESSAGE };
        text = String(input);
    } else if (typeof input === 'string') {
        text = input.trim();
    } else {
        return { ok: false, message: FORMAT_MESSAGE };
    }

    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        return { ok: false, message: FORMAT_MESSAGE };
    }

    const [whole, fraction = ''] = text.split('.');
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

    if (minor <= 0) return { ok: false, message: 'Amount must be greater than zero' };
    if (minor > MAX_MINOR) return { ok: false, message: 'Amount is too large' };

    return { ok: true, minor };
};

const formatMinor = (minor) => (minor / 100).toFixed(2);

module.exports = { CURRENCIES, parseMoney, formatMinor };
