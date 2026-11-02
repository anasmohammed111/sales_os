const mongoose = require('mongoose');
const User = require('../models/User');
const Lead = require('../models/Leads');
const FollowUp = require('../models/FollowUp');
const bcrypt = require('bcryptjs');

const createTeamMember = async (req, res) => {
    try {
        // 1. Check authorization
        if (req.user?.role !== 'OWNER') {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to perform this action.',
            });
        }

        // 2. Get and validate request data
        const { name, email, password, role, managerId } = req.body || {};

        if (
            typeof name !== 'string' ||
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            typeof role !== 'string' ||
            !name.trim() ||
            !email.trim() ||
            !password ||
            !role
        ) {
            return res.status(400).json({
                success: false,
                message: 'Please fill in all required fields.',
            });
        }

        const trimmedName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();

        // 3. Validate field lengths
        if (trimmedName.length < 2 || trimmedName.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Name must be between 2 and 100 characters.',
            });
        }

        if (normalizedEmail.length > 254) {
            return res.status(400).json({
                success: false,
                message: 'Email address is too long.',
            });
        }

        // 4. Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address.',
            });
        }

        // 5. Validate password
        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({
                success: false,
                message: 'Password must be between 8 and 128 characters.',
            });
        }

        // 6. Restrict allowed roles
        const allowedRoles = ['SALES_MANAGER', 'SALESPERSON'];

        if (!allowedRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Please select a valid team member role.',
            });
        }

        // 7. Ensure the authenticated owner has a business
        if (!req.user.businessId) {
            return res.status(403).json({
                success: false,
                message: 'Your account is not associated with a business.',
            });
        }

        // 8. Validate manager for SALESPERSON (Required)
        let resolvedManagerId = null;
        if (role === 'SALESPERSON') {
            if (!managerId || (typeof managerId === 'string' && !managerId.trim())) {
                return res.status(400).json({
                    success: false,
                    message: 'Please select a sales manager.',
                });
            }

            if (!mongoose.isValidObjectId(managerId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid sales manager ID.',
                });
            }

            const manager = await User.findOne({
                _id: managerId,
                businessId: req.user.businessId,
                role: 'SALES_MANAGER',
                isActive: true,
            });

            if (!manager) {
                return res.status(400).json({
                    success: false,
                    message: 'Selected sales manager does not exist or is inactive.',
                });
            }

            resolvedManagerId = manager._id;
        }

        // 9. Check whether email already exists
        const existingUser = await User.findOne({
            email: normalizedEmail,
        }).lean();

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.',
            });
        }

        // 10. Hash password before saving
        const hashedPassword = await bcrypt.hash(password, 12);

        // 11. Create team member under the owner's business
        const teamMember = await User.create({
            name: trimmedName,
            email: normalizedEmail,
            password: hashedPassword,
            role,
            managerId: resolvedManagerId,
            businessId: req.user.businessId,
        });

        const safeMember = await User.findById(teamMember._id)
            .select('-password')
            .populate('managerId', 'name email role');

        // 12. Return safe member information
        return res.status(201).json({
            success: true,
            message: 'Team member created successfully.',
            data: safeMember,
        });
    } catch (error) {
        // Handle duplicate email race conditions
        if (error.code === 11000 && error.keyPattern?.email) {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.',
            });
        }

        console.error('Create team member error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to create team member. Please try again later.',
        });
    }
};

const getTeamMembers = async (req, res) => {
    try {
        // Only OWNER can view team members
        if (req.user.role !== 'OWNER') {
            return res.status(403).json({
                success: false,
                message: 'Only the business owner can view team members.',
            });
        }

        const {
            role = 'ALL',
            status = 'ALL',
            search = '',
            page = 1,
            limit = 10,
        } = req.query;

        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

        // All team members in this business
        const baseFilter = {
            businessId: req.user.businessId,
            role: { $in: ['SALES_MANAGER', 'SALESPERSON'] },
        };

        // Apply filters to the team list
        const filter = { ...baseFilter };

        if (role !== 'ALL') {
            if (!['SALES_MANAGER', 'SALESPERSON'].includes(role)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid role filter.',
                });
            }

            filter.role = role;
        }

        if (status === 'ACTIVE') {
            filter.isActive = true;
        } else if (status === 'INACTIVE') {
            filter.isActive = false;
        } else if (status !== 'ALL') {
            return res.status(400).json({
                success: false,
                message: 'Invalid status filter.',
            });
        }

        if (typeof search === 'string' && search.trim()) {
            const safeSearch = search.trim().slice(0, 100).replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            filter.$or = [
                { name: { $regex: safeSearch, $options: 'i' } },
                { email: { $regex: safeSearch, $options: 'i' } },
            ];
        }

        // Get summary counts for the full team
        const [
            totalMembers,
            activeMembers,
            inactiveMembers,
            salesManagers,
            salespersons,
        ] = await Promise.all([
            User.countDocuments(baseFilter),
            User.countDocuments({ ...baseFilter, isActive: true }),
            User.countDocuments({ ...baseFilter, isActive: false }),
            User.countDocuments({ ...baseFilter, role: 'SALES_MANAGER' }),
            User.countDocuments({ ...baseFilter, role: 'SALESPERSON' }),
        ]);

        // Count members matching the selected filters
        const total = await User.countDocuments(filter);

        // Get members for the current page
        const teamMembers = await User.find(filter)
            .select('-password')
            .populate('managerId', 'name email role')
            .sort({ createdAt: -1 })
            .skip((currentPage - 1) * pageSize)
            .limit(pageSize);

        return res.status(200).json({
            success: true,

            summary: {
                totalMembers,
                activeMembers,
                inactiveMembers,
                salesManagers,
                salespersons,
            },

            data: teamMembers,

            pagination: {
                total,
                page: currentPage,
                limit: pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (error) {
        console.error('Get team members error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to retrieve team members.',
        });
    }
};

const updateTeamMember = async (req, res) => {
    try {
        // 1. Only the business Owner can update team members
        if (req.user.role !== 'OWNER') {
            return res.status(403).json({
                success: false,
                message: 'Only the business owner can update team members.',
            });
        }

        // 2. Get the member ID and fields from the request
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid team member ID.',
            });
        }

        const { name, email, role, isActive, managerId } = req.body || {};

        const allowedRoles = ['SALES_MANAGER', 'SALESPERSON'];

        // 3. Validate the role if it is provided
        if (
            role !== undefined &&
            !allowedRoles.includes(role)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid team member role.',
            });
        }

        // 4. Find the member within the Owner's business
        const teamMember = await User.findOne({
            _id: id,
            businessId: req.user.businessId,
            role: { $in: allowedRoles },
        });

        if (!teamMember) {
            return res.status(404).json({
                success: false,
                message: 'Team member not found.',
            });
        }

        // 5. Update the name if provided
        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Name cannot be empty.',
                });
            }

            const trimmedName = name.trim();
            if (trimmedName.length < 2 || trimmedName.length > 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Name must be between 2 and 100 characters.',
                });
            }

            teamMember.name = trimmedName;
        }

        // 6. Update the email if provided
        if (email !== undefined) {
            if (typeof email !== 'string' || !email.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Email cannot be empty.',
                });
            }

            const normalizedEmail = email.trim().toLowerCase();

            if (normalizedEmail.length > 254) {
                return res.status(400).json({
                    success: false,
                    message: 'Email address is too long.',
                });
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(normalizedEmail)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid email address.',
                });
            }

            // Check whether another user already uses this email
            const existingUser = await User.findOne({
                email: normalizedEmail,
                _id: { $ne: teamMember._id },
            });

            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    message: 'This email is already registered.',
                });
            }

            teamMember.email = normalizedEmail;
        }

        // 7. Update the role if provided
        if (role !== undefined) {
            teamMember.role = role;
            if (role === 'SALES_MANAGER') {
                teamMember.managerId = null;
            }
        }

        // 8. Update managerId if provided and member is SALESPERSON (Required for SALESPERSON)
        const finalRole = role !== undefined ? role : teamMember.role;
        if (finalRole === 'SALESPERSON') {
            if (managerId !== undefined) {
                if (!managerId || (typeof managerId === 'string' && !managerId.trim())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Please select a sales manager.',
                    });
                }

                if (!mongoose.isValidObjectId(managerId)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid sales manager ID.',
                    });
                }

                const manager = await User.findOne({
                    _id: managerId,
                    businessId: req.user.businessId,
                    role: 'SALES_MANAGER',
                    isActive: true,
                });

                if (!manager) {
                    return res.status(400).json({
                        success: false,
                        message: 'Selected sales manager does not exist or is inactive.',
                    });
                }

                teamMember.managerId = manager._id;
            } else if (role === 'SALESPERSON' && !teamMember.managerId) {
                return res.status(400).json({
                    success: false,
                    message: 'Please select a sales manager.',
                });
            }
        } else {
            teamMember.managerId = null;
        }

        // 9. Activate or deactivate the member if provided
        if (isActive !== undefined) {
            if (typeof isActive !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    message: 'isActive must be true or false.',
                });
            }

            teamMember.isActive = isActive;
        }

        // 10. Save all changes to MongoDB
        await teamMember.save();
        await teamMember.populate('managerId', 'name email role');

        // 11. Return the updated member details
        return res.status(200).json({
            success: true,
            message: 'Team member updated successfully.',
            data: {
                id: teamMember._id,
                name: teamMember.name,
                email: teamMember.email,
                role: teamMember.role,
                managerId: teamMember.managerId,
                isActive: teamMember.isActive,
            },
        });
    } catch (error) {
        console.error('Update team member error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid team member ID.',
            });
        }

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'This email is already registered.',
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Unable to update team member.',
        });
    }
};

const deactivateTeamMember = async (req, res) => {
    try {
        // Only the business Owner can deactivate team members
        if (req.user.role !== 'OWNER') {
            return res.status(403).json({
                success: false,
                message: 'Only the business owner can deactivate team members.',
            });
        }

        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid team member ID.',
            });
        }

        // Find the member within the Owner's business
        const teamMember = await User.findOne({
            _id: id,
            businessId: req.user.businessId,
            role: {
                $in: ['SALES_MANAGER', 'SALESPERSON'],
            },
        });

        if (!teamMember) {
            return res.status(404).json({
                success: false,
                message: 'Team member not found.',
            });
        }

        // Avoid repeating the same operation
        if (!teamMember.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Team member is already inactive.',
            });
        }

        // Deactivate the member
        teamMember.isActive = false;

        await teamMember.save();

        return res.status(200).json({
            success: true,
            message: 'Team member deactivated successfully.',
            data: {
                id: teamMember._id,
                name: teamMember.name,
                email: teamMember.email,
                role: teamMember.role,
                isActive: teamMember.isActive,
            },
        });
    } catch (error) {
        console.error('Deactivate team member error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid team member ID.',
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Unable to deactivate team member.',
        });
    }
};

const deleteTeamMember = async (req, res) => {
    try {
        if (req.user.role !== 'OWNER') {
            return res.status(403).json({
                success: false,
                message: 'Only the business owner can delete team members.',
            });
        }

        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid team member ID.',
            });
        }

        const teamMember = await User.findOne({
            _id: id,
            businessId: req.user.businessId,
            role: {
                $in: ['SALES_MANAGER', 'SALESPERSON'],
            },
        });

        if (!teamMember) {
            return res.status(404).json({
                success: false,
                message: 'Team member not found.',
            });
        }

        // Prevent deletion if the member still owns active leads or pending follow-ups
        const [activeLeadsCount, activeFollowUpsCount] = await Promise.all([
            Lead.countDocuments({
                businessId: req.user.businessId,
                assignedTo: teamMember._id,
                isArchived: false,
            }),
            FollowUp.countDocuments({
                businessId: req.user.businessId,
                assignedTo: teamMember._id,
                status: 'PENDING',
                isArchived: false,
            }),
        ]);

        if (activeLeadsCount > 0 || activeFollowUpsCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete team member with ${activeLeadsCount} active lead(s) and ${activeFollowUpsCount} pending follow-up(s). Please reassign them or deactivate the member instead.`,
            });
        }

        await User.deleteOne({
            _id: teamMember._id,
            businessId: req.user.businessId,
        });

        return res.status(200).json({
            success: true,
            message: 'Team member permanently deleted.',
        });
    } catch (error) {
        console.error('Delete team member error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid team member ID.',
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Unable to delete team member.',
        });
    }
};

module.exports = { createTeamMember, getTeamMembers, updateTeamMember, deactivateTeamMember, deleteTeamMember };