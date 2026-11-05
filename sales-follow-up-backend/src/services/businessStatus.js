// A company's lifecycle status. Documents created before `status` existed fall
// back to `isActive`; `isActive` is kept in step so older checks still work.
const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'];

const businessStatus = (business) => {
    if (!business) return 'ARCHIVED';
    if (BUSINESS_STATUSES.includes(business.status)) return business.status;
    return business.isActive === false ? 'SUSPENDED' : 'ACTIVE';
};

const isBusinessActive = (business) => businessStatus(business) === 'ACTIVE';

const suspendedResponse = (res) =>
    res.status(403).json({
        success: false,
        code: 'COMPANY_SUSPENDED',
        message: 'This workspace is suspended. Contact Kelto support.',
    });

module.exports = { BUSINESS_STATUSES, businessStatus, isBusinessActive, suspendedResponse };
