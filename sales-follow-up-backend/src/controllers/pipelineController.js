const mongoose = require('mongoose');
const Lead = require('../models/Leads');
const User = require('../models/User');
const { can, scopeOf, inScope, visibleUserIds } = require('../services/access');

const PIPELINE_STAGES = [
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

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

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

    // The pipeline shows leads, so it follows the person's lead scope
    if (!can(req, 'pipeline.view') || !can(req, 'leads.view')) {
        return { _id: null };
    }

    const filter = {
        businessId: businessObjectId,
        isArchived: { $ne: true },
    };

    const ids = await visibleUserIds(req, 'leads');
    if (ids) filter.assignedTo = { $in: ids };
    return filter;
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

        // Optional filter: a team member inside the person's lead scope
        if (assignedTo && assignedTo !== 'ALL') {
            if (!mongoose.isValidObjectId(assignedTo)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid assignee ID',
                });
            }

            if (assignedTo.toString() !== req.user.userId.toString() && scopeOf(req, 'leads') === 'own') {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot filter by other team members',
                });
            }

            if (!(await inScope(req, 'leads', assignedTo))) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only filter your own team members',
                });
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
        const { status, lostReason, notes, nextFollowUpAt, estimatedValue, isArchived } = req.body;

        // Archiving from the pipeline is still archiving a lead
        if (isArchived === true && !can(req, 'leads.archive')) {
            return res.status(403).json({
                success: false,
                code: 'PERMISSION_DENIED',
                message: 'You do not have permission to archive leads',
            });
        }

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

        // If lead is already in this status, update any supplementary fields without error
        if (lead.status === status) {
            const extraUpdates = {};
            if (notes !== undefined) extraUpdates.notes = notes;
            if (nextFollowUpAt !== undefined) extraUpdates.nextFollowUpAt = nextFollowUpAt;
            if (estimatedValue !== undefined) extraUpdates.estimatedValue = estimatedValue;
            if (isArchived !== undefined) extraUpdates.isArchived = isArchived;

            if (Object.keys(extraUpdates).length > 0) {
                await Lead.updateOne({ _id: lead._id }, { $set: extraUpdates });
            }

            return res.status(200).json({
                success: true,
                message: 'Lead pipeline status updated',
                data: {
                    ...lead.toObject(),
                    ...extraUpdates,
                    leadId: lead._id,
                    status: lead.status,
                },
            });
        }

        const allowedNextStages = ALLOWED_STATUS_TRANSITIONS[lead.status] || [];
        if (!allowedNextStages.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot transition lead from ${lead.status} to ${status}`,
            });
        }

        const updates = { status };
        let historyReason = '';

        if (notes !== undefined) updates.notes = notes;
        if (nextFollowUpAt !== undefined) updates.nextFollowUpAt = nextFollowUpAt;
        if (estimatedValue !== undefined) updates.estimatedValue = estimatedValue;
        if (isArchived !== undefined) updates.isArchived = isArchived;

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

        // Status change history
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
