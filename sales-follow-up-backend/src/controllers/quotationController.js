const mongoose = require('mongoose');
const crypto = require('crypto');

const Quotation = require('../models/Quotation');
const { SUPPORTED_CURRENCIES } = require('../models/Quotation');
const Lead = require('../models/Leads');
const User = require('../models/User');
const { can, inScope, scopeOf, visibleUserIds } = require('../services/access');

const VALID_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

// Manual transitions allowed by users. EXPIRED is handled automatically by the background expiry job.
const ALLOWED_STATUS_TRANSITIONS = {
    DRAFT: ['SENT'],
    SENT: ['ACCEPTED', 'REJECTED'],
    ACCEPTED: [],
    REJECTED: [],
    EXPIRED: [],
};

// Custom error for client-side bad requests (distinguished from unexpected 500 errors)
class BadRequestError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BadRequestError';
    }
}

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const toObjectId = (id) => (mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null);

const generateQuotationNumber = () =>
    `QT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// Centralized error handler distinguishing client errors from unexpected system errors
const handleQuotationError = (res, error, action) => {
    console.error(`${action} error:`, error);

    if (error.code === 11000) {
        return res.status(409).json({
            success: false,
            message: 'A quotation with this number already exists. Please retry.',
        });
    }

    if (error instanceof BadRequestError || error.name === 'ValidationError' || error.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: error.message || 'Invalid quotation data',
        });
    }

    // Unexpected runtime/database errors return 500
    return res.status(500).json({
        success: false,
        message: 'Internal server error occurred while processing quotation',
    });
};

// Validate text string lengths and supported ISO currency code
const validateTextFields = ({ subject, termsAndConditions, customerNotes, internalNotes, currency }) => {
    if (subject !== undefined) {
        if (typeof subject !== 'string' || subject.trim().length > 200) {
            throw new BadRequestError('Subject must be a string up to 200 characters');
        }
    }
    if (termsAndConditions !== undefined) {
        if (typeof termsAndConditions !== 'string' || termsAndConditions.length > 5000) {
            throw new BadRequestError('Terms and conditions must be a string up to 5000 characters');
        }
    }
    if (customerNotes !== undefined) {
        if (typeof customerNotes !== 'string' || customerNotes.length > 2000) {
            throw new BadRequestError('Customer notes must be a string up to 2000 characters');
        }
    }
    if (internalNotes !== undefined) {
        if (typeof internalNotes !== 'string' || internalNotes.length > 2000) {
            throw new BadRequestError('Internal notes must be a string up to 2000 characters');
        }
    }
    if (currency !== undefined) {
        const upper = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
        if (!SUPPORTED_CURRENCIES.includes(upper)) {
            throw new BadRequestError(
                `Unsupported currency "${currency}". Supported currencies: ${SUPPORTED_CURRENCIES.join(', ')}`
            );
        }
    }
};

// Whether this person may quote for a lead: the lead must be inside their quotation scope
const canAccessLead = async (req, lead) => inScope(req, 'quotations', lead.assignedTo);

// Quotations this person may see: their business and their quotation data scope
const getQuotationScope = async (req) => {
    const businessId = toObjectId(req.user?.businessId);
    const userId = toObjectId(req.user?.userId);

    if (!businessId || !userId || !can(req, 'quotations.view')) {
        return { scope: { _id: null }, teamIds: [] };
    }

    const scope = { businessId };
    const ids = await visibleUserIds(req, 'quotations');
    if (ids) scope.assignedTo = { $in: ids };
    return { scope, teamIds: ids || [] };
};

// Calculate item and quotation totals with strict number and discount validation
const calculateQuotation = (items, overallDiscount = 0) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new BadRequestError('At least one quotation item is required');
    }
    if (items.length > 100) {
        throw new BadRequestError('Maximum 100 quotation items are allowed');
    }

    // Strict validation: Reject non-numbers or invalid discount values rather than coercing to 0
    if (typeof overallDiscount !== 'number' || !Number.isFinite(overallDiscount) || overallDiscount < 0) {
        throw new BadRequestError('Overall discount must be a valid non-negative number');
    }

    let subtotal = 0;
    let totalItemDiscount = 0;
    let totalTax = 0;

    const calculatedItems = items.map((item, index) => {
        const itemName = typeof item.itemName === 'string' ? item.itemName.trim() : '';
        if (!itemName || itemName.length > 200) {
            throw new BadRequestError(`Item #${index + 1} must have a valid name (up to 200 characters)`);
        }

        if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
            throw new BadRequestError(`Quantity for "${itemName}" must be a positive number`);
        }

        if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
            throw new BadRequestError(`Unit price for "${itemName}" must be a non-negative number`);
        }

        const itemDiscount = item.discount ?? 0;
        if (typeof itemDiscount !== 'number' || !Number.isFinite(itemDiscount) || itemDiscount < 0) {
            throw new BadRequestError(`Discount for "${itemName}" must be a valid non-negative number`);
        }

        const taxRate = item.taxRate ?? 0;
        if (typeof taxRate !== 'number' || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
            throw new BadRequestError(`Tax rate for "${itemName}" must be between 0% and 100%`);
        }

        if (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 1000)) {
            throw new BadRequestError(`Description for "${itemName}" must be a string up to 1000 characters`);
        }

        if (item.unit !== undefined && (typeof item.unit !== 'string' || item.unit.trim().length > 30)) {
            throw new BadRequestError(`Unit for "${itemName}" must be a string up to 30 characters`);
        }

        const grossAmount = roundMoney(item.quantity * item.unitPrice);
        if (itemDiscount > grossAmount) {
            throw new BadRequestError(`Discount (${itemDiscount}) exceeds item amount (${grossAmount}) for "${itemName}"`);
        }

        const taxableAmount = roundMoney(grossAmount - itemDiscount);
        const taxAmount = roundMoney((taxableAmount * taxRate) / 100);
        const amount = roundMoney(taxableAmount + taxAmount);

        subtotal = roundMoney(subtotal + grossAmount);
        totalItemDiscount = roundMoney(totalItemDiscount + itemDiscount);
        totalTax = roundMoney(totalTax + taxAmount);

        const calculated = {
            itemName,
            description: typeof item.description === 'string' ? item.description.trim() : '',
            quantity: item.quantity,
            unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim() : 'PCS',
            unitPrice: item.unitPrice,
            discount: itemDiscount,
            taxRate,
            taxAmount,
            amount,
        };

        if (item._id && mongoose.isValidObjectId(item._id)) {
            calculated._id = item._id;
        }

        return calculated;
    });

    const discountedSubtotal = roundMoney(subtotal - totalItemDiscount);
    if (overallDiscount > discountedSubtotal) {
        throw new BadRequestError(`Overall discount (${overallDiscount}) cannot exceed subtotal after item discounts (${discountedSubtotal})`);
    }

    const grandTotal = roundMoney(discountedSubtotal - overallDiscount + totalTax);

    return {
        items: calculatedItems,
        subtotal,
        discount: overallDiscount,
        taxAmount: totalTax,
        grandTotal,
    };
};

// Validate quotation date and expiry date with business integrity rules
const validateDates = (quotationDate, validUntil) => {
    const qDate = new Date(quotationDate);
    const vDate = new Date(validUntil);
    const now = new Date();

    if (Number.isNaN(qDate.getTime()) || Number.isNaN(vDate.getTime())) {
        throw new BadRequestError('Valid quotation and expiry dates are required');
    }

    // Quotation date cannot be set in the future
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (qDate > endOfToday) {
        throw new BadRequestError('Quotation date cannot be in the future');
    }

    // Disallow extreme backdating (>30 days) to prevent historical distortion
    const maxBackdateDays = 30;
    const minAllowedDate = new Date();
    minAllowedDate.setDate(minAllowedDate.getDate() - maxBackdateDays);
    minAllowedDate.setHours(0, 0, 0, 0);
    if (qDate < minAllowedDate) {
        throw new BadRequestError(`Quotation date cannot be backdated by more than ${maxBackdateDays} days`);
    }

    // Expiry date must strictly be after quotation date
    if (vDate <= qDate) {
        throw new BadRequestError('Expiry date (validUntil) must be strictly after the quotation date');
    }

    // Expiry date must be in the future when creating or modifying dates
    if (vDate <= now) {
        throw new BadRequestError('Quotation expiry date must be in the future');
    }

    return { quotationDate: qDate, validUntil: vDate };
};

// Create a new quotation in DRAFT status
const createQuotation = async (req, res) => {
    try {
        const { userId, businessId } = req.user;
        if (!can(req, 'quotations.create')) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to create quotations',
            });
        }

        const {
            leadId,
            quotationDate,
            validUntil,
            subject = '',
            items,
            discount = 0,
            currency = 'INR',
            termsAndConditions = '',
            customerNotes = '',
            internalNotes = '',
        } = req.body;

        if (!mongoose.isValidObjectId(leadId)) {
            return res.status(400).json({ success: false, message: 'Invalid lead ID' });
        }

        const lead = await Lead.findOne({
            _id: leadId,
            businessId,
            isArchived: { $ne: true },
        });

        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found or archived' });
        }

        if (!(await canAccessLead(req, lead))) {
            return res.status(403).json({
                success: false,
                message: 'You cannot create a quotation for this lead',
            });
        }

        const dates = validateDates(quotationDate, validUntil);
        const totals = calculateQuotation(items, discount);
        validateTextFields({ subject, termsAndConditions, customerNotes, internalNotes, currency });

        const quotation = await Quotation.create({
            businessId,
            leadId: lead._id,
            quotationNumber: generateQuotationNumber(),
            customer: {
                name: lead.customerName,
                companyName: lead.companyName || '',
                email: lead.email || '',
                phone: lead.phone || '',
                billingAddress: '',
            },
            quotationDate: dates.quotationDate,
            validUntil: dates.validUntil,
            subject: subject.trim(),
            ...totals,
            currency: currency.trim().toUpperCase(),
            status: 'DRAFT',
            termsAndConditions: termsAndConditions.trim(),
            customerNotes: customerNotes.trim(),
            internalNotes: internalNotes.trim(),
            assignedTo: lead.assignedTo || userId,
            createdBy: userId,
        });

        return res.status(201).json({
            success: true,
            message: 'Quotation created successfully',
            data: quotation,
        });
    } catch (error) {
        return handleQuotationError(res, error, 'Create quotation');
    }
};

// List quotations with scoped filtering, search, and pagination
const getQuotations = async (req, res) => {
    try {
        const { userId } = req.user;
        const { scope } = await getQuotationScope(req);

        const {
            status,
            search,
            assignedTo,
            page = 1,
            limit = 10,
            startDate,
            endDate,
        } = req.query;

        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

        if (status) {
            const normalizedStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
            if (normalizedStatus && normalizedStatus !== 'ALL') {
                if (!VALID_STATUSES.includes(normalizedStatus)) {
                    return res.status(400).json({ success: false, message: 'Invalid quotation status' });
                }
                scope.status = normalizedStatus;
            }
        }

        // Enforce strict manager & salesperson assignedTo filtering
        if (assignedTo && assignedTo !== 'ALL') {
            if (!mongoose.isValidObjectId(assignedTo)) {
                return res.status(400).json({ success: false, message: 'Invalid assigned user ID' });
            }

            const targetUserId = assignedTo.toString();

            if (targetUserId !== userId.toString() && scopeOf(req, 'quotations') === 'own') {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot view other users quotations',
                });
            }
            if (!(await inScope(req, 'quotations', targetUserId))) {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot filter quotations for users outside your team',
                });
            }
            scope.assignedTo = new mongoose.Types.ObjectId(assignedTo);
        }

        if (search && typeof search === 'string') {
            const safeSearch = search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (safeSearch) {
                scope.$or = [
                    { quotationNumber: { $regex: safeSearch, $options: 'i' } },
                    { 'customer.name': { $regex: safeSearch, $options: 'i' } },
                    { 'customer.companyName': { $regex: safeSearch, $options: 'i' } },
                    { 'customer.email': { $regex: safeSearch, $options: 'i' } },
                ];
            }
        }

        if (startDate || endDate) {
            const dateFilter = {};
            if (startDate) {
                const start = new Date(startDate);
                if (Number.isNaN(start.getTime())) {
                    return res.status(400).json({ success: false, message: 'Invalid start date' });
                }
                dateFilter.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                if (Number.isNaN(end.getTime())) {
                    return res.status(400).json({ success: false, message: 'Invalid end date' });
                }
                end.setHours(23, 59, 59, 999);
                dateFilter.$lte = end;
            }
            scope.quotationDate = dateFilter;
        }

        const skip = (currentPage - 1) * pageSize;

        // Base scope for summary counts across user's authorized domain
        const summaryScope = { businessId: scope.businessId };
        if (scope.assignedTo) {
            summaryScope.assignedTo = scope.assignedTo;
        }

        const [quotations, total, statusCounts] = await Promise.all([
            Quotation.find(scope)
                .populate('leadId', 'customerName companyName status')
                .populate('assignedTo', 'name email role')
                .populate('createdBy', 'name email role')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(pageSize)
                .lean(),
            Quotation.countDocuments(scope),
            Quotation.aggregate([
                { $match: summaryScope },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);

        const countsMap = statusCounts.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, {});

        const draft = countsMap.DRAFT || 0;
        const sent = countsMap.SENT || 0;
        const accepted = countsMap.ACCEPTED || 0;
        const rejected = countsMap.REJECTED || 0;
        const expired = countsMap.EXPIRED || 0;
        const totalQuotations = draft + sent + accepted + rejected + expired;

        return res.status(200).json({
            success: true,
            data: quotations,
            summary: {
                total: totalQuotations,
                draft,
                sent,
                accepted,
                rejected,
                expired,
                totalQuotations,
                totalQuotationsCount: totalQuotations,
                draftCount: draft,
                sentCount: sent,
                acceptedCount: accepted,
            },
            pagination: {
                total,
                page: currentPage,
                limit: pageSize,
                totalPages: Math.ceil(total / pageSize),
                hasNextPage: skip + quotations.length < total,
                hasPreviousPage: currentPage > 1,
            },
        });
    } catch (error) {
        return handleQuotationError(res, error, 'Get quotations');
    }
};

// Retrieve single quotation by ID within authorized scope
const getQuotationById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid quotation ID' });
        }

        const { scope } = await getQuotationScope(req);
        const quotation = await Quotation.findOne({ ...scope, _id: id })
            .populate('leadId', 'customerName companyName email phone status')
            .populate('assignedTo', 'name email role')
            .populate('createdBy', 'name email role')
            .lean();

        if (!quotation) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        return res.status(200).json({
            success: true,
            data: quotation,
        });
    } catch (error) {
        return handleQuotationError(res, error, 'Get quotation');
    }
};

// Update draft quotation with strict validation and optimistic concurrency locking
const updateQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid quotation ID' });
        }

        const { scope } = await getQuotationScope(req);
        const quotation = await Quotation.findOne({ ...scope, _id: id });

        if (!quotation) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        if (quotation.status !== 'DRAFT') {
            return res.status(400).json({
                success: false,
                message: 'Only draft quotations can be edited',
            });
        }

        const {
            quotationDate,
            validUntil,
            subject,
            items,
            discount,
            currency,
            termsAndConditions,
            customerNotes,
            internalNotes,
        } = req.body;

        validateTextFields({ subject, termsAndConditions, customerNotes, internalNotes, currency });

        const updates = {};

        if (quotationDate !== undefined || validUntil !== undefined) {
            const dates = validateDates(
                quotationDate ?? quotation.quotationDate,
                validUntil ?? quotation.validUntil
            );
            updates.quotationDate = dates.quotationDate;
            updates.validUntil = dates.validUntil;
        }

        if (subject !== undefined) {
            updates.subject = subject.trim();
        }

        if (items !== undefined || discount !== undefined) {
            const itemsToCalc = items !== undefined ? items : quotation.items.map((i) => i.toObject());
            const discountToCalc = discount !== undefined ? discount : quotation.discount;
            const totals = calculateQuotation(itemsToCalc, discountToCalc);
            Object.assign(updates, totals);
        }

        if (currency !== undefined) {
            updates.currency = currency.trim().toUpperCase();
        }

        if (termsAndConditions !== undefined) updates.termsAndConditions = termsAndConditions.trim();
        if (customerNotes !== undefined) updates.customerNotes = customerNotes.trim();
        if (internalNotes !== undefined) updates.internalNotes = internalNotes.trim();

        // Optimistic lock check against updatedAt to prevent lost updates
        const updatedQuotation = await Quotation.findOneAndUpdate(
            {
                ...scope,
                _id: id,
                status: 'DRAFT',
                updatedAt: quotation.updatedAt,
            },
            { $set: updates },
            { new: true, runValidators: true }
        )
            .populate('leadId', 'customerName companyName status')
            .populate('assignedTo', 'name email role')
            .populate('createdBy', 'name email role');

        if (!updatedQuotation) {
            return res.status(409).json({
                success: false,
                message: 'Quotation was modified by another user. Please refresh and try again.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Quotation updated successfully',
            data: updatedQuotation,
        });
    } catch (error) {
        return handleQuotationError(res, error, 'Update quotation');
    }
};

// Transition quotation status according to allowed state machine
const updateQuotationStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid quotation ID' });
        }

        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid quotation status' });
        }

        // Automatic expiry is the primary mechanism; prevent manual forced expiration
        if (status === 'EXPIRED') {
            return res.status(400).json({
                success: false,
                message: 'Quotations expire automatically based on validity date and cannot be manually expired.',
            });
        }

        const { scope } = await getQuotationScope(req);
        const quotation = await Quotation.findOne({ ...scope, _id: id });

        if (!quotation) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        if (!ALLOWED_STATUS_TRANSITIONS[quotation.status]?.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot transition quotation from ${quotation.status} to ${status}`,
            });
        }

        const timestamp = new Date();
        const updates = { status };

        if (status === 'SENT') updates.sentAt = timestamp;
        if (status === 'ACCEPTED') updates.acceptedAt = timestamp;
        if (status === 'REJECTED') updates.rejectedAt = timestamp;

        // Concurrency guard: Ensure status hasn't changed between read and write
        const updatedQuotation = await Quotation.findOneAndUpdate(
            {
                ...scope,
                _id: id,
                status: quotation.status,
            },
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!updatedQuotation) {
            return res.status(409).json({
                success: false,
                message: 'Quotation status was changed concurrently. Please refresh.',
            });
        }

        return res.status(200).json({
            success: true,
            message: `Quotation marked as ${status}`,
            data: updatedQuotation,
        });
    } catch (error) {
        return handleQuotationError(res, error, 'Update quotation status');
    }
};

// Permanently delete a draft quotation
const deleteQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: 'Invalid quotation ID' });
        }

        const { scope } = await getQuotationScope(req);
        const quotation = await Quotation.findOneAndDelete({
            ...scope,
            _id: id,
            status: 'DRAFT',
        });

        if (!quotation) {
            return res.status(404).json({
                success: false,
                message: 'Draft quotation not found or you do not have permission to delete it',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Quotation deleted successfully',
        });
    } catch (error) {
        return handleQuotationError(res, error, 'Delete quotation');
    }
};

module.exports = {
    createQuotation,
    getQuotations,
    getQuotationById,
    updateQuotation,
    updateQuotationStatus,
    deleteQuotation,
};
