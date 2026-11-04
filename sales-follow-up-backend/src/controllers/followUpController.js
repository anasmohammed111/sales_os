const mongoose = require('mongoose');
const FollowUp = require('../models/FollowUp');
const Lead = require('../models/Leads');
const User = require('../models/User');

const VALID_TYPES = [
    'CALL',
    'WHATSAPP',
    'EMAIL',
    'MEETING',
    'OTHER',
    // Admissions task types
    'TASK',
    'DOCUMENT',
    'PAYMENT',
    'EXAM',
    'INTERVIEW',
    'VISA',
];

const VALID_STATUSES = [
    'PENDING',
    'COMPLETED',
    'CANCELLED',
];

const canManageTeam = (role) =>
    ['OWNER', 'SALES_MANAGER'].includes(role);

// Common access filter based on business and team hierarchy
const getFollowUpScope = async (req, isArchived = false) => {
    const filter = {
        businessId: req.user.businessId,
        isArchived,
    };

    // Owner can see all follow-ups in their business
    if (req.user.role === 'OWNER') {
        return filter;
    }

    // Salesperson can see only their own follow-ups
    if (req.user.role === 'SALESPERSON') {
        filter.assignedTo = req.user.userId;
        return filter;
    }

    // Manager can see their own follow-ups and their salespersons' follow-ups
    if (req.user.role === 'SALES_MANAGER') {
        const salespersons = await User.find({
            businessId: req.user.businessId,
            managerId: req.user.userId,
            role: 'SALESPERSON',
        }).select('_id');

        const assignedUsers = salespersons.map((user) => user._id);
        assignedUsers.push(req.user.userId);

        filter.assignedTo = {
            $in: assignedUsers,
        };

        return filter;
    }

    // No access for other roles
    filter._id = null;
    return filter;
};

// Validate and resolve follow-up assignee based on role and team hierarchy
const validateFollowUpAssignee = async (req, assignedTo) => {
    if (assignedTo === null || assignedTo === '') {
        return { assigneeId: null };
    }

    if (!mongoose.isValidObjectId(assignedTo)) {
        return {
            status: 400,
            error: 'Invalid assignee ID',
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

    // Salesperson can only assign to themselves
    if (req.user.role === 'SALESPERSON') {
        if (assignee._id.toString() !== req.user.userId.toString()) {
            return {
                status: 403,
                error: 'You can only assign follow-ups to yourself',
            };
        }
    }

    // Manager can assign only to themselves or their own salespersons
    if (req.user.role === 'SALES_MANAGER') {
        const isSelf = assignee._id.toString() === req.user.userId.toString();
        const isOwnSalesperson =
            assignee.role === 'SALESPERSON' &&
            assignee.managerId?.toString() === req.user.userId.toString();

        if (!isSelf && !isOwnSalesperson) {
            return {
                status: 403,
                error: 'You can only assign follow-ups to yourself or your own salespersons',
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

// Standard error handler matching leadController
const handleError = (res, error, action) => {
    console.error(`${action} error:`, error.message);

    if (error.name === 'ValidationError' || error.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: 'Invalid follow-up data',
        });
    }

    return res.status(500).json({
        success: false,
        message: `${action} failed`,
    });
};

// CREATE
const createFollowUp = async (req, res) => {
    try {
        const {
            leadId,
            assignedTo,
            type,
            scheduledAt,
            notes,
        } = req.body;

        // 1. Validate Lead Selection
        if (!leadId) {
            return res.status(400).json({
                success: false,
                message: 'Please select a customer or lead.',
            });
        }

        if (!mongoose.isValidObjectId(leadId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid customer or lead ID.',
            });
        }

        const lead = await Lead.findOne({
            _id: leadId,
            businessId: req.user.businessId,
            isArchived: false,
        });

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Selected lead not found.',
            });
        }

        // Salesperson can only schedule follow-ups for leads assigned to them
        if (
            req.user.role === 'SALESPERSON' &&
            lead.assignedTo?.toString() !== req.user.userId.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: 'You cannot schedule a follow-up for this lead.',
            });
        }

        // 2. Validate Follow-up Type
        if (!type) {
            return res.status(400).json({
                success: false,
                message: 'Follow-up type is required.',
            });
        }

        if (!VALID_TYPES.includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Please select a valid follow-up type.',
            });
        }

        // 3. Validate Scheduled Date & Time
        if (!scheduledAt || typeof scheduledAt !== 'string' || !scheduledAt.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Scheduled date and time are required.',
            });
        }

        const scheduledDate = new Date(scheduledAt);

        if (!Number.isFinite(scheduledDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid scheduled date and time.',
            });
        }

        // 4. Validate Notes
        if (notes !== undefined && notes !== null) {
            if (typeof notes !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Notes must be text.',
                });
            }

            if (notes.length > 2000) {
                return res.status(400).json({
                    success: false,
                    message: 'Notes cannot exceed 2000 characters.',
                });
            }
        }

        // 5. Determine Assignee
        let assigneeId = null;
        if (assignedTo && canManageTeam(req.user.role)) {
            const validation = await validateFollowUpAssignee(req, assignedTo);
            if (validation.error) {
                return res.status(validation.status).json({
                    success: false,
                    message: validation.error,
                });
            }
            assigneeId = validation.assigneeId;
        } else {
            // Default assignee: salesperson is always self; manager/owner defaults to lead assignee or self
            if (req.user.role === 'SALESPERSON') {
                assigneeId = req.user.userId;
            } else {
                assigneeId = lead.assignedTo || req.user.userId;
            }
        }

        const followUp = await FollowUp.create({
            businessId: req.user.businessId,
            leadId: lead._id,
            assignedTo: assigneeId,
            createdBy: req.user.userId,
            type,
            scheduledAt: scheduledDate,
            notes: typeof notes === 'string' ? notes.trim() : '',
            status: 'PENDING',
        });

        await followUp.populate([
            { path: 'leadId', select: 'customerName companyName phone email status priority' },
            { path: 'assignedTo', select: 'name email role' },
            { path: 'createdBy', select: 'name email role' },
        ]);

        return res.status(201).json({
            success: true,
            message: 'Follow-up created successfully.',
            data: followUp,
        });
    } catch (error) {
        return handleError(res, error, 'Create follow-up');
    }
};

// LIST
const getFollowUps = async (req, res) => {
    try {
        const isArchived = req.query?.archived === 'true' || req.query?.isArchived === 'true';
        const filter = await getFollowUpScope(req, isArchived);

        const {
            status,
            type,
            leadId,
            assignedTo,
            search = '',
            page = '1',
            limit = '10',
        } = req.query;

        // Validate status filter
        if (status && status !== 'ALL') {
            if (!VALID_STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid follow-up status.',
                });
            }
            filter.status = status;
        }

        // Validate type filter
        if (type && type !== 'ALL') {
            if (!VALID_TYPES.includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid follow-up type.',
                });
            }
            filter.type = type;
        }

        // Validate lead filter
        if (leadId && leadId !== 'ALL') {
            if (!mongoose.isValidObjectId(leadId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid lead ID.',
                });
            }
            filter.leadId = leadId;
        }

        // Validate assignedTo filter
        if (assignedTo && assignedTo !== 'ALL') {
            if (!canManageTeam(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot filter by other team members.',
                });
            }

            if (!mongoose.isValidObjectId(assignedTo)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid assignee ID.',
                });
            }

            if (req.user.role === 'SALES_MANAGER') {
                const allowedTeamIds = Array.isArray(filter.assignedTo?.$in)
                    ? filter.assignedTo.$in.map((id) => id.toString())
                    : [];

                if (!allowedTeamIds.includes(assignedTo.toString())) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only filter your own team members.',
                    });
                }
            }

            filter.assignedTo = assignedTo;
        }

        // Search by customer name, company name, notes, or outcome
        if (typeof search === 'string' && search.trim()) {
            const safeSearch = search.trim().slice(0, 100).replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            const matchingLeads = await Lead.find({
                businessId: req.user.businessId,
                $or: [
                    { customerName: { $regex: safeSearch, $options: 'i' } },
                    { companyName: { $regex: safeSearch, $options: 'i' } },
                ],
            })
                .select('_id')
                .lean();

            const matchingLeadIds = matchingLeads.map((l) => l._id);

            filter.$or = [
                { leadId: { $in: matchingLeadIds } },
                { notes: { $regex: safeSearch, $options: 'i' } },
                { outcome: { $regex: safeSearch, $options: 'i' } },
            ];
        }

        // Pagination
        const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));

        // Time boundaries for summary counts
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        const summaryScope = await getFollowUpScope(req, false);

        // Fetch follow-ups and summary metrics in parallel
        const [followUps, total, today, overdue, upcoming, completed] = await Promise.all([
            FollowUp.find(filter)
                .populate('leadId', 'customerName companyName phone email status priority')
                .populate('assignedTo', 'name email role')
                .populate('createdBy', 'name email role')
                .sort({ scheduledAt: 1 })
                .skip((currentPage - 1) * pageSize)
                .limit(pageSize)
                .lean(),

            FollowUp.countDocuments(filter),

            // Today count
            FollowUp.countDocuments({
                ...summaryScope,
                scheduledAt: { $gte: startOfDay, $lte: endOfDay },
            }),

            // Overdue count
            FollowUp.countDocuments({
                ...summaryScope,
                status: 'PENDING',
                scheduledAt: { $lt: startOfDay },
            }),

            // Upcoming count
            FollowUp.countDocuments({
                ...summaryScope,
                status: 'PENDING',
                scheduledAt: { $gt: endOfDay },
            }),

            // Completed count
            FollowUp.countDocuments({
                ...summaryScope,
                status: 'COMPLETED',
            }),
        ]);

        return res.status(200).json({
            success: true,
            data: followUps,
            summary: {
                today,
                overdue,
                upcoming,
                completed,
            },
            pagination: {
                total,
                page: currentPage,
                limit: pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (error) {
        return handleError(res, error, 'Get follow-ups');
    }
};

// UPDATE
const updateFollowUp = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid follow-up ID.',
            });
        }

        const allowedFields = [
            'type',
            'scheduledAt',
            'status',
            'notes',
            'outcome',
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
                message: 'No valid fields provided for update.',
            });
        }

        if (updates.type !== undefined) {
            if (!VALID_TYPES.includes(updates.type)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please select a valid follow-up type.',
                });
            }
        }

        if (updates.scheduledAt !== undefined) {
            if (!updates.scheduledAt || typeof updates.scheduledAt !== 'string' || !updates.scheduledAt.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Scheduled date and time cannot be empty.',
                });
            }

            const date = new Date(updates.scheduledAt);
            if (!Number.isFinite(date.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide a valid scheduled date and time.',
                });
            }

            updates.scheduledAt = date;
        }

        if (updates.status !== undefined) {
            if (!VALID_STATUSES.includes(updates.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please select a valid follow-up status.',
                });
            }

            updates.completedAt = updates.status === 'COMPLETED' ? new Date() : null;
        }

        if (updates.notes !== undefined) {
            if (typeof updates.notes !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Notes must be text.',
                });
            }

            if (updates.notes.length > 2000) {
                return res.status(400).json({
                    success: false,
                    message: 'Notes cannot exceed 2000 characters.',
                });
            }

            updates.notes = updates.notes.trim();
        }

        if (updates.outcome !== undefined) {
            if (typeof updates.outcome !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Outcome must be text.',
                });
            }

            if (updates.outcome.length > 2000) {
                return res.status(400).json({
                    success: false,
                    message: 'Outcome cannot exceed 2000 characters.',
                });
            }

            updates.outcome = updates.outcome.trim();
        }

        // Support updating assignedTo if provided
        if (Object.hasOwn(req.body, 'assignedTo')) {
            if (!canManageTeam(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot reassign follow-ups.',
                });
            }

            const validation = await validateFollowUpAssignee(req, req.body.assignedTo);
            if (validation.error) {
                return res.status(validation.status).json({
                    success: false,
                    message: validation.error,
                });
            }

            updates.assignedTo = validation.assigneeId;
        }

        const scope = await getFollowUpScope(req, false);

        const followUp = await FollowUp.findOneAndUpdate(
            { ...scope, _id: req.params.id },
            { $set: updates },
            { new: true, runValidators: true }
        )
            .populate('leadId', 'customerName companyName phone email status priority')
            .populate('assignedTo', 'name email role')
            .populate('createdBy', 'name email role');

        if (!followUp) {
            return res.status(404).json({
                success: false,
                message: 'Follow-up not found.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Follow-up updated successfully.',
            data: followUp,
        });
    } catch (error) {
        return handleError(res, error, 'Update follow-up');
    }
};

// ARCHIVE
const archiveFollowUp = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid follow-up ID.',
            });
        }

        const scope = await getFollowUpScope(req, false);

        const followUp = await FollowUp.findOneAndUpdate(
            { ...scope, _id: req.params.id },
            { $set: { isArchived: true } },
            { new: true }
        );

        if (!followUp) {
            return res.status(404).json({
                success: false,
                message: 'Follow-up not found.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Follow-up moved to archive.',
        });
    } catch (error) {
        return handleError(res, error, 'Archive follow-up');
    }
};

// PERMANENT DELETE (Owner only, must already be archived)
const deleteFollowUp = async (req, res) => {
    try {
        if (req.user.role !== 'OWNER') {
            return res.status(403).json({
                success: false,
                message: 'Only the owner can permanently delete follow-ups.',
            });
        }

        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid follow-up ID.',
            });
        }

        const followUp = await FollowUp.findOneAndDelete({
            _id: req.params.id,
            businessId: req.user.businessId,
            isArchived: true,
        });

        if (!followUp) {
            return res.status(404).json({
                success: false,
                message: 'Archived follow-up not found.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Follow-up permanently deleted.',
        });
    } catch (error) {
        return handleError(res, error, 'Delete follow-up');
    }
};

module.exports = {
    getFollowUpScope,
    createFollowUp,
    getFollowUps,
    updateFollowUp,
    archiveFollowUp,
    deleteFollowUp,
};
