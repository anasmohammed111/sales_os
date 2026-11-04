
const mongoose = require('mongoose');
const Lead = require('../models/Leads');
const User = require('../models/User');

const VALID_STATUSES = [
    'NEW',
    'CONTACTED',
    'QUALIFIED',
    'QUOTATION_SENT',
    'NEGOTIATION',
    'WON',
    'ADMISSIONS',
    'ON_HOLD',
    'CLOSED',
    'NO_LONGER_REQUIRED',
    'UNRESPONSIVE',
    'LOST',
];

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

const TERMINAL_OR_EXIT_STATUSES = [
    'CLOSED',
    'NO_LONGER_REQUIRED',
    'ADMISSIONS',
    'ON_HOLD',
    'UNRESPONSIVE',
    'LOST',
];

const ALLOWED_STATUS_TRANSITIONS = {
    NEW: ['CONTACTED', 'QUALIFIED', ...TERMINAL_OR_EXIT_STATUSES],
    CONTACTED: ['NEW', 'QUALIFIED', 'QUOTATION_SENT', ...TERMINAL_OR_EXIT_STATUSES],
    QUALIFIED: ['CONTACTED', 'QUOTATION_SENT', 'NEGOTIATION', ...TERMINAL_OR_EXIT_STATUSES],
    QUOTATION_SENT: ['QUALIFIED', 'NEGOTIATION', 'WON', ...TERMINAL_OR_EXIT_STATUSES],
    NEGOTIATION: ['QUOTATION_SENT', 'WON', ...TERMINAL_OR_EXIT_STATUSES],
    WON: ['ADMISSIONS', 'CLOSED', 'NEW'],
    ADMISSIONS: ['WON', 'CLOSED', 'NEW'],
    ON_HOLD: ['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED', 'NO_LONGER_REQUIRED', 'LOST'],
    CLOSED: ['NEW', 'CONTACTED', 'QUALIFIED', 'ADMISSIONS'],
    NO_LONGER_REQUIRED: ['NEW', 'CONTACTED'],
    UNRESPONSIVE: ['NEW', 'CONTACTED', 'CLOSED', 'NO_LONGER_REQUIRED', 'LOST'],
    LOST: ['NEW', 'CONTACTED', 'CLOSED'],
};

const VALID_SOURCES = [
    'WHATSAPP',
    'PHONE',
    'EMAIL',
    'WEBSITE',
    'WALK_IN',
    'REFERRAL',
    'OTHER',
];

const canManageTeam = (role) =>
    ['OWNER', 'SALES_MANAGER'].includes(role);

const getLeadScope = async (req) => {
    // If businessId or userId is missing or invalid, block access completely
    if (
        !req.user?.businessId ||
        !mongoose.isValidObjectId(req.user.businessId) ||
        !req.user?.userId ||
        !mongoose.isValidObjectId(req.user.userId)
    ) {
        return { _id: null };
    }

    const filter = {
        businessId: req.user.businessId,
        isArchived: { $ne: true },
    };

    // Owner can see all leads in their business.
    if (req.user.role === 'OWNER') {
        return filter;
    }

    // Salesperson can see only their own leads.
    if (req.user.role === 'SALESPERSON') {
        filter.assignedTo = req.user.userId;
        return filter;
    }

    // Manager can see their own leads and their salespersons' leads.
    if (req.user.role === 'SALES_MANAGER') {

        const salespersons = await User.find({
            businessId: req.user.businessId,
            managerId: req.user.userId,
            role: 'SALESPERSON',
        }).select('_id');

        const assignedUsers = salespersons.map(user => user._id);

        // Include the manager themselves.
        assignedUsers.push(req.user.userId);

        filter.assignedTo = {
            $in: assignedUsers,
        };

        return filter;
    }

    // No access for other roles.
    filter._id = null;

    return filter;
};

// Validate and resolve lead assignee based on role and team hierarchy
const validateLeadAssignee = async (req, assignedTo) => {
    // Check unassign permission
    if (assignedTo === null || assignedTo === '') {
        if (req.user.role !== 'OWNER') {
            return {
                status: 403,
                error: 'Only the owner can unassign a lead',
            };
        }
        return { assigneeId: null };
    }

    if (!mongoose.isValidObjectId(assignedTo)) {
        return {
            status: 400,
            error: 'Invalid assignee',
        };
    }

    const assignee = await User.findOne({
        _id: assignedTo,
        businessId: req.user.businessId,
        isActive: true,
        role: { $in: ['OWNER', 'SALES_MANAGER', 'SALESPERSON'] },
    });

    if (!assignee) {
        return {
            status: 400,
            error: 'Assignee not found',
        };
    }

    // Manager can assign only to themselves or their own salespersons.
    if (req.user.role === 'SALES_MANAGER') {
        const isSelf = assignee._id.toString() === req.user.userId.toString();
        const isOwnSalesperson =
            assignee.role === 'SALESPERSON' &&
            assignee.managerId?.toString() === req.user.userId.toString();

        if (!isSelf && !isOwnSalesperson) {
            return {
                status: 403,
                error: 'You can only assign leads to yourself or your own salespersons',
            };
        }
    }

    // Owner cannot assign to other owners (only to themselves, managers, or salespersons)
    if (
        req.user.role === 'OWNER' &&
        assignee.role === 'OWNER' &&
        assignee._id.toString() !== req.user.userId.toString()
    ) {
        return {
            status: 403,
            error: 'Invalid assignee',
        };
    }

    return { assigneeId: assignee._id };
};

const handleError = (res, error, action) => {
    console.error(`${action} error:`, error.message);

    if (error.name === 'ValidationError' || error.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: 'Invalid lead data',
        });
    }

    return res.status(500).json({
        success: false,
        message: `${action} failed`,
    });
};

// Create lead
const createLead = async (req, res) => {
    try {
        const {
            customerName,
            companyName,
            email,
            phone,
            source,
            interestedIn,
            estimatedValue,
            priority,
            assignedTo,
            nextFollowUpAt,
            notes,
        } = req.body;

        if (typeof customerName !== 'string' || !customerName.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Customer name is required',
            });
        }

        const trimmedCustomerName = customerName.trim();
        if (trimmedCustomerName.length > 120) {
            return res.status(400).json({
                success: false,
                message: 'Customer name must not exceed 120 characters',
            });
        }

        let normalizedEmail = '';
        if (email !== undefined && email !== null && email !== '') {
            if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid email address',
                });
            }
            normalizedEmail = email.trim().toLowerCase();
        }

        // Default assignee is the logged-in user.
        let assigneeId = req.user.userId;

        if (assignedTo && canManageTeam(req.user.role)) {
            const validation = await validateLeadAssignee(req, assignedTo);
            if (validation.error) {
                return res.status(validation.status).json({
                    success: false,
                    message: validation.error,
                });
            }
            assigneeId = validation.assigneeId;
        }

        if (source && !VALID_SOURCES.includes(source)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid lead source',
            });
        }

        if (priority && !VALID_PRIORITIES.includes(priority)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid priority',
            });
        }

        if (
            estimatedValue !== undefined &&
            (!Number.isFinite(Number(estimatedValue)) ||
                Number(estimatedValue) < 0)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Estimated value must be a non-negative number',
            });
        }

        if (nextFollowUpAt && Number.isNaN(Date.parse(nextFollowUpAt))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid follow-up date',
            });
        }

        const lead = await Lead.create({
            businessId: req.user.businessId,
            customerName: trimmedCustomerName,
            companyName: typeof companyName === 'string' ? companyName.trim() : '',
            email: normalizedEmail,
            phone: typeof phone === 'string' ? phone.trim() : '',
            source: source || 'OTHER',
            interestedIn: typeof interestedIn === 'string' ? interestedIn.trim() : '',
            estimatedValue,
            priority,
            assignedTo: assigneeId,
            createdBy: req.user.userId,
            nextFollowUpAt: nextFollowUpAt || null,
            notes: typeof notes === 'string' ? notes.trim() : '',
            status: 'NEW',
        });

        await lead.populate([
            { path: 'assignedTo', select: 'name email role' },
            { path: 'createdBy', select: 'name email' },
        ]);

        return res.status(201).json({
            success: true,
            message: 'Lead created successfully',
            data: lead,
        });
    } catch (error) {
        return handleError(res, error, 'Create lead');
    }
};

// List leads
const getLeads = async (req, res) => {
    try {
        const {
            status,
            priority,
            assignedTo,
            search,
            dueOnly,
            page = '1',
            limit = '10',
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = req.query;

        const filter = await getLeadScope(req);

        // Filter by status.
        if (status && status !== 'ALL') {
            if (!VALID_STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status filter',
                });
            }

            filter.status = status;
        }

        // Filter by priority.
        if (priority && priority !== 'ALL') {
            if (!VALID_PRIORITIES.includes(priority)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid priority filter',
                });
            }

            filter.priority = priority;
        }

        // Filter by team member.
        if (assignedTo && assignedTo !== 'ALL') {
            if (!canManageTeam(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot filter by other team members',
                });
            }

            if (!mongoose.isValidObjectId(assignedTo)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid assignee ID',
                });
            }

            // Check whether the selected user is within the manager's team.
            if (req.user.role === 'SALES_MANAGER') {
                const allowedTeamIds = Array.isArray(filter.assignedTo?.$in)
                    ? filter.assignedTo.$in.map(id => id.toString())
                    : [];

                if (!allowedTeamIds.includes(assignedTo.toString())) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only filter your own team members',
                    });
                }
            }

            filter.assignedTo = assignedTo;
        }

        // Search customer, company, email, phone or product interest.
        if (typeof search === 'string' && search.trim()) {
            const safeSearch = search.trim().slice(0, 100).replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            filter.$or = [
                { customerName: { $regex: safeSearch, $options: 'i' } },
                { companyName: { $regex: safeSearch, $options: 'i' } },
                { email: { $regex: safeSearch, $options: 'i' } },
                { phone: { $regex: safeSearch, $options: 'i' } },
                { interestedIn: { $regex: safeSearch, $options: 'i' } },
            ];
        }

        // Find overdue or currently due follow-ups.
        if (dueOnly === 'true') {
            filter.nextFollowUpAt = {
                $ne: null,
                $lte: new Date(),
            };

            filter.status = {
                ...(filter.status ? { $eq: filter.status } : {}),
                $nin: ['WON', 'LOST'],
            };
        }

        // Limit which fields the client is allowed to sort by.
        const allowedSortFields = [
            'createdAt',
            'updatedAt',
            'estimatedValue',
            'customerName',
            'companyName',
            'email',
            'phone',
            'source',
            'status',
            'priority',
            'nextFollowUpAt',
        ];

        const safeSortBy = allowedSortFields.includes(sortBy)
            ? sortBy
            : 'createdAt';

        const sort = {
            [safeSortBy]: sortOrder === 'asc' ? 1 : -1,
        };

        const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
        const pageSize = Math.min(
            100,
            Math.max(1, Number.parseInt(limit, 10) || 10)
        );

        const [leads, total] = await Promise.all([
            Lead.find(filter)
                .populate('assignedTo', 'name email role')
                .populate('createdBy', 'name email')
                .sort(sort)
                .skip((currentPage - 1) * pageSize)
                .limit(pageSize)
                .lean(),

            Lead.countDocuments(filter),
        ]);

        return res.status(200).json({
            success: true,
            data: {
                leads,
                pagination: {
                    total,
                    page: currentPage,
                    limit: pageSize,
                    totalPages: Math.ceil(total / pageSize),
                },
            },
        });
    } catch (error) {
        return handleError(res, error, 'Get leads');
    }
};

// List leads by id
const getLeadById = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid lead ID',
            });
        }

        // Get role-based lead access filter.
        const leadScope = await getLeadScope(req);

        const lead = await Lead.findOne({
            ...leadScope,
            _id: req.params.id,
        })
            .populate('assignedTo', 'name email role')
            .populate('createdBy', 'name email')
            .populate('statusHistory.changedBy', 'name email role');

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found',
            });
        }

        return res.status(200).json({
            success: true,
            data: lead,
        });
    } catch (error) {
        return handleError(res, error, 'Get lead');
    }
};

// Update Lead
const updateLead = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid lead ID',
            });
        }

        const allowedFields = [
            'customerName',
            'companyName',
            'email',
            'phone',
            'source',
            'interestedIn',
            'estimatedValue',
            'status',
            'priority',
            'nextFollowUpAt',
            'notes',
            'lostReason',
        ];

        const updates = {};

        for (const field of allowedFields) {
            if (Object.hasOwn(req.body, field)) {
                updates[field] = req.body[field];
            }
        }

        if (Object.keys(updates).length === 0 && !Object.hasOwn(req.body, 'assignedTo')) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields provided for update',
            });
        }

        if (
            updates.status &&
            !VALID_STATUSES.includes(updates.status)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid lead status',
            });
        }

        if (
            updates.priority &&
            !VALID_PRIORITIES.includes(updates.priority)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid priority',
            });
        }

        if (updates.customerName !== undefined) {
            if (typeof updates.customerName !== 'string' || !updates.customerName.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Customer name is required',
                });
            }

            updates.customerName = updates.customerName.trim();

            if (updates.customerName.length > 120) {
                return res.status(400).json({
                    success: false,
                    message: 'Customer name must not exceed 120 characters',
                });
            }
        }

        if (updates.source !== undefined) {
            if (!VALID_SOURCES.includes(updates.source)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid lead source',
                });
            }
        }

        if (typeof updates.companyName === 'string') {
            updates.companyName = updates.companyName.trim();
        }

        if (typeof updates.phone === 'string') {
            updates.phone = updates.phone.trim();
        }

        if (typeof updates.interestedIn === 'string') {
            updates.interestedIn = updates.interestedIn.trim();
        }

        if (typeof updates.notes === 'string') {
            updates.notes = updates.notes.trim();
        }

        if (typeof updates.lostReason === 'string') {
            updates.lostReason = updates.lostReason.trim();
        }

        if (updates.estimatedValue !== undefined) {
            const numVal = Number(updates.estimatedValue);
            if (!Number.isFinite(numVal) || numVal < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Estimated value must be a non-negative number',
                });
            }
            updates.estimatedValue = numVal;
        }

        if (updates.email !== undefined) {
            // Allow empty string or null explicitly to clear the email address
            if (updates.email === null || (typeof updates.email === 'string' && !updates.email.trim())) {
                updates.email = '';
            } else {
                if (typeof updates.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email.trim())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid email address',
                    });
                }
                updates.email = updates.email.trim().toLowerCase();
            }
        }

        if (updates.nextFollowUpAt) {
            if (Number.isNaN(Date.parse(updates.nextFollowUpAt))) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid follow-up date',
                });
            }
        }

        // Only owners/managers can reassign leads.
        if (Object.hasOwn(req.body, 'assignedTo')) {
            if (!canManageTeam(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot reassign leads',
                });
            }

            const validation = await validateLeadAssignee(req, req.body.assignedTo);
            if (validation.error) {
                return res.status(validation.status).json({
                    success: false,
                    message: validation.error,
                });
            }

            updates.assignedTo = validation.assigneeId;
        }

        const leadScope = await getLeadScope(req);

        // Fetch lead first to check existence and validate status transition if status is being updated
        const existingLead = await Lead.findOne({
            ...leadScope,
            _id: req.params.id,
        });

        if (!existingLead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found',
            });
        }

        let pushStatusHistory = null;
        if (updates.status && updates.status !== existingLead.status) {
            if (existingLead.status === 'WON') {
                return res.status(400).json({
                    success: false,
                    message: 'Closed WON deals cannot change status',
                });
            }

            const allowedNextStages = ALLOWED_STATUS_TRANSITIONS[existingLead.status] || [];
            if (!allowedNextStages.includes(updates.status)) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot transition lead from ${existingLead.status} to ${updates.status}`,
                });
            }

            let historyReason = '';
            if (updates.status === 'LOST') {
                const reasonCandidate = updates.lostReason !== undefined ? updates.lostReason : req.body.lostReason;
                if (!reasonCandidate || typeof reasonCandidate !== 'string' || !reasonCandidate.trim()) {
                    return res.status(400).json({
                        success: false,
                        message: 'Lost reason is required when marking a lead as LOST',
                    });
                }

                const trimmedReason = reasonCandidate.trim();
                if (trimmedReason.length < 3 || trimmedReason.length > 500) {
                    return res.status(400).json({
                        success: false,
                        message: 'Lost reason must be between 3 and 500 characters',
                    });
                }

                updates.lostReason = trimmedReason;
                historyReason = trimmedReason;
            } else {
                updates.lostReason = '';
            }

            pushStatusHistory = {
                fromStatus: existingLead.status,
                toStatus: updates.status,
                changedBy: req.user.userId,
                changedAt: new Date(),
                reason: historyReason,
            };
        } else if (updates.status === existingLead.status) {
            // Remove redundant status update
            delete updates.status;
        }

        const updateOperation = { $set: updates };
        if (pushStatusHistory) {
            updateOperation.$push = { statusHistory: pushStatusHistory };
        }

        const lead = await Lead.findOneAndUpdate(
            {
                ...leadScope,
                _id: req.params.id,
            },
            updateOperation,
            {
                new: true,
                runValidators: true,
            }
        )
            .populate('assignedTo', 'name email role')
            .populate('createdBy', 'name email')
            .populate('statusHistory.changedBy', 'name email role');

        return res.status(200).json({
            success: true,
            message: 'Lead updated successfully',
            data: lead,
        });
    } catch (error) {
        return handleError(res, error, 'Update lead');
    }
};

// Archive lead.
const archiveLead = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid lead ID',
            });
        }

        // Get role-based lead access filter.
        const leadScope = await getLeadScope(req);

        const lead = await Lead.findOneAndUpdate(
            {
                ...leadScope,
                _id: req.params.id,
            },
            {
                $set: {
                    isArchived: true,
                },
            },
            {
                new: true,
            }
        );

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Lead archived successfully',
        });
    } catch (error) {
        return handleError(res, error, 'Archive lead');
    }
};

module.exports = {
    getLeadScope,
    createLead,
    getLeads,
    getLeadById,
    updateLead,
    archiveLead,
};
