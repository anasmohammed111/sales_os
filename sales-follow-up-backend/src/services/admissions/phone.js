/**
 * Normalises a phone number for duplicate detection: digits only, and the
 * last ten digits when longer, so "+91 98765-43210" and "098765 43210" match.
 */
const normalizePhone = (raw) => {
    const digits = String(raw ?? '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
};

module.exports = { normalizePhone };
