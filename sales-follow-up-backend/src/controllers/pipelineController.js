const mongoose = require('mongoose');
const Lead = require('../models/Leads');
const User = require('../models/User');

const PIPELINE_STAGES = [
    'NEW',
    'CONTACTED',
    'QUALIFIED',
    'QUOTATION_SENT',
    'NEGOTIATION',
    'WON',
    'LOST',
];

const ALLOWED_STATUS_TRANSITIONS = {
    NEW: ['CONTACTED', 'QUALIFIED', 'LOST'],
    CONTACTED: ['NEW', 'QUALIFIED', 'QUOTATION_SENT', 'LOST'],
    QUALIFIED: ['CONTACTED', 'QUOTATION_SENT', 'NEGOTIATION', 'LOST'],
    QUOTATION_SENT: ['QUALIFIED', 'NEGOTIATION', 'WON', 'LOST'],
    NEGOTIATION: ['QUOTATION_SENT', 'WON', 'LOST'],
    WON: [], // Terminal closed-won stage
    LOST: ['NEW', 'CONTACTED'], // Reopening a lost lead
};

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

const canManageTeam = (role) =>
    ['OWNER', 'SALES_MANAGER'].includes(role);

// Helper to safely convert string to ObjectId for aggregation
const toObjectId = (id) =>
    mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null;

// Get leads accessible to the logged-in user (properly typed for aggregation and queries)
const getPipelineScope = async (req) => {
    const businessObjectId = toObjectId(req.user?.businessId);
    const userObjectId = toObjectId(req.user?.userId);

    // If businessId or userId is missing or invalid, block access completely
    if (!businessObjectId || !userObjectId) {
        return { _id: null };
    }

    const filter = {
        businessId: businessObjectId,
        isArchived: { $ne: true },
    };

    // Owner can see all leads in their business
    if (req.user.role === 'OWNER') {
        return filter;
    }

    // Salesperson can see only their own leads
    if (req.user.role === 'SALESPERSON') {
        filter.assignedTo = userObjectId;
        return filter;
    }

    // Manager can see their own leads and their salespersons' leads
    if (req.user.role === 'SALES_MANAGER') {
        const salespersons = await User.find({
            businessId: req.user.businessId,
            managerId: req.user.userId,
            role: 'SALESPERSON',
        })
            .select('_id')
            .lean();

        const teamIds = salespersons.map((user) => user._id);

        filter.assignedTo = {
            $in: [
                userObjectId,
                ...teamIds,
            ],
        };

        return filter;
    }

    // No access for other roles
    return { _id: null };
};

// Standard error handler matching leadController and followUpController
const handleError = (res, error, action) => {
    console.error(`${action} error:`, error.message);

    if (error.name === 'ValidationError' || error.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: 'Invalid pipeline data',
        });
    }

    return res.status(500).json({
        success: false,
        message: `${action} failed`,
    });
};

// GET PIPELINE
const getPipeline = async (req, res) => {
    try {
        const scope = await getPipelineScope(req);

        const { assignedTo, priority, search, limit } = req.query;

        // Limit number of lead cards returned per stage (default 50, maximum 100)
        const stageLimit = Math.min(
            100,
            Math.max(1, Number.parseInt(limit, 10) || 50)
        );

        // Optional filter: assigned team member
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

            if (req.user.role === 'SALES_MANAGER') {
                const allowedTeamIds = Array.isArray(scope.assignedTo?.$in)
                    ? scope.assignedTo.$in.map((id) => id.toString())
                    : [];

                if (!allowedTeamIds.includes(assignedTo.toString())) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only filter your own team members',
                    });
                }
            }

            scope.assignedTo = toObjectId(assignedTo);
        }

        // Optional filter: priority
        if (priority && priority !== 'ALL') {
            if (!VALID_PRIORITIES.includes(priority)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid priority filter',
                });
            }

            scope.priority = priority;
        }

        // Optional filter: search text
        if (typeof search === 'string' && search.trim()) {
            const safeSearch = search.trim().slice(0, 100).replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            scope.$or = [
                { customerName: { $regex: safeSearch, $options: 'i' } },
                { companyName: { $regex: safeSearch, $options: 'i' } },
                { email: { $regex: safeSearch, $options: 'i' } },
                { phone: { $regex: safeSearch, $options: 'i' } },
                { interestedIn: { $regex: safeSearch, $options: 'i' } },
            ];
        }

        const pipeline = await Lead.aggregate([
            {
                $match: scope,
            },
            {
                $setWindowFields: {
                    partitionBy: '$status',
                    sortBy: { createdAt: -1 },
                    output: {
                        rank: { $documentNumber: {} },
                        totalLeads: { $count: {} },
                        totalEstimatedValue: {
                            $sum: { $ifNull: ['$estimatedValue', 0] },
                        },
                    },
                },
            },
            {
                $match: {
                    rank: { $lte: stageLimit },
                },
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'assignedTo',
                    foreignField: '_id',
                    as: 'assignedToUser',
                    pipeline: [
                        { $project: { name: 1, email: 1, role: 1 } },
                    ],
                },
            },
            {
                $addFields: {
                    assignedTo: { $arrayElemAt: ['$assignedToUser', 0] },
                },
            },
            {
                $project: {
                    assignedToUser: 0,
                    rank: 0,
                },
            },
            {
                $group: {
                    _id: '$status',
                    totalLeads: { $first: '$totalLeads' },
                    totalEstimatedValue: { $first: '$totalEstimatedValue' },
                    leads: { $push: '$$ROOT' },
                },
            },
        ]);

        const stageMap = new Map(
            pipeline.map((stage) => [stage._id, stage])
        );

        const result = PIPELINE_STAGES.map((status) => {
            const stage = stageMap.get(status);

            return {
                status,
                totalLeads: stage ? stage.totalLeads : 0,
                totalEstimatedValue: stage ? stage.totalEstimatedValue : 0,
                leads: stage ? stage.leads : [],
                limit: stageLimit,
                hasMore: stage ? stage.totalLeads > stage.leads.length : false,
            };
        });

        const activeStages = [
            'NEW',
            'CONTACTED',
            'QUALIFIED',
            'QUOTATION_SENT',
            'NEGOTIATION',
        ];

        const activeLeads = result
            .filter((stage) => activeStages.includes(stage.status))
            .reduce((sum, stage) => sum + (stage.totalLeads || 0), 0);

        const pipelineValue = result
            .filter((stage) => activeStages.includes(stage.status))
            .reduce((sum, stage) => sum + (stage.totalEstimatedValue || 0), 0);

        const wonStage = result.find((stage) => stage.status === 'WON');
        const wonDeals = wonStage ? wonStage.totalLeads : 0;
        const wonValue = wonStage ? wonStage.totalEstimatedValue : 0;

        const lostStage = result.find((stage) => stage.status === 'LOST');
        const lostDeals = lostStage ? lostStage.totalLeads : 0;
        const lostValue = lostStage ? lostStage.totalEstimatedValue : 0;

        const allLeads = result.reduce(
            (sum, stage) => sum + (stage.totalLeads || 0),
            0
        );

        const summary = {
            totalLeads: activeLeads,
            pipelineValue,
            wonDeals,
            lostDeals,
            wonDealsCount: wonDeals,
            lostDealsCount: lostDeals,
            activeLeads,
            allLeads,
            totalAllLeads: allLeads,
            wonValue,
            lostValue,
        };

        return res.status(200).json({
            success: true,
            summary,
            data: result,
        });
    } catch (error) {
        return handleError(res, error, 'Get pipeline');
    }
};

// UPDATE PIPELINE STATUS
const updatePipelineStatus = async (req, res) => {
    try {
        const { leadId } = req.params;
        const { status, lostReason } = req.body;

        if (!mongoose.isValidObjectId(leadId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid lead ID',
            });
        }

        if (!PIPELINE_STAGES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid pipeline status',
            });
        }

        const scope = await getPipelineScope(req);

        // Fetch lead first to validate current status and transition
        const lead = await Lead.findOne({
            ...scope,
            _id: toObjectId(leadId),
        });

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found',
            });
        }

        // Issue 5: Missing status transition validation
        if (lead.status === status) {
            return res.status(400).json({
                success: false,
                message: `Lead is already in ${status} status`,
            });
        }

        if (lead.status === 'WON') {
            return res.status(400).json({
                success: false,
                message: 'Closed WON deals cannot change status',
            });
        }

        const allowedNextStages = ALLOWED_STATUS_TRANSITIONS[lead.status] || [];
        if (!allowedNextStages.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot transition lead from ${lead.status} to ${status}`,
            });
        }

        // Issue 6: Lost reason needs validation
        const updates = { status };
        let historyReason = '';

        if (status === 'LOST') {
            if (!lostReason || typeof lostReason !== 'string' || !lostReason.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Lost reason is required when marking a lead as LOST',
                });
            }

            const trimmedReason = lostReason.trim();
            if (trimmedReason.length < 3 || trimmedReason.length > 500) {
                return res.status(400).json({
                    success: false,
                    message: 'Lost reason must be between 3 and 500 characters',
                });
            }

            updates.lostReason = trimmedReason;
            historyReason = trimmedReason;
        } else {
            // When moving to any status other than LOST, clear the lostReason
            updates.lostReason = '';
        }

        // Issue 7: Status change history
        const updatedLead = await Lead.findOneAndUpdate(
            {
                ...scope,
                _id: toObjectId(leadId),
                status: lead.status, // Optimistic concurrency check
            },
            {
                $set: updates,
                $push: {
                    statusHistory: {
                        fromStatus: lead.status,
                        toStatus: status,
                        changedBy: toObjectId(req.user.userId),
                        changedAt: new Date(),
                        reason: historyReason,
                    },
                },
            },
            {
                new: true,
                runValidators: true,
            }
        )
            .populate('assignedTo', 'name email role')
            .populate('createdBy', 'name email')
            .populate('statusHistory.changedBy', 'name email role');

        if (!updatedLead) {
            return res.status(409).json({
                success: false,
                message: 'Lead status was modified by another operation. Please refresh and try again.',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Pipeline status updated successfully',
            data: {
                ...updatedLead.toObject(),
                leadId: updatedLead._id,
                status: updatedLead.status,
            },
        });
    } catch (error) {
        return handleError(res, error, 'Update pipeline status');
    }
};

module.exports = {
    getPipeline,
    updatePipelineStatus,
};
