const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Business = require('../models/Business');
const { generateToken } = require('../services/authService');

const register = async (req, res) => {
    let createdBusinessId = null;

    try {
        const {
            businessName,
            name,
            email,
            phone,
            password,
        } = req.body || {};

        if (
            typeof businessName !== 'string' ||
            typeof name !== 'string' ||
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !businessName.trim() ||
            !name.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message:
                    'Business name, name, email and password are required',
            });
        }

        const trimmedBusinessName = businessName.trim();
        const trimmedName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();

        if (trimmedBusinessName.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Business name must not exceed 100 characters',
            });
        }

        if (trimmedName.length < 2 || trimmedName.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Name must be between 2 and 100 characters',
            });
        }

        if (normalizedEmail.length > 254) {
            return res.status(400).json({
                success: false,
                message: 'Email address is too long',
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address',
            });
        }

        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({
                success: false,
                message: 'Password must be between 8 and 128 characters',
            });
        }

        const safePhone = typeof phone === 'string' ? phone.trim().slice(0, 30) : '';

        const existingUser = await User.findOne({
            email: normalizedEmail,
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists',
            });
        }

        const business = await Business.create({
            businessName: trimmedBusinessName,
            email: normalizedEmail,
            phone: safePhone,
        });
        createdBusinessId = business._id;

        const hashedPassword = await bcrypt.hash(
            password,
            12
        );

        const user = await User.create({
            businessId: business._id,
            name: trimmedName,
            email: normalizedEmail,
            phone: safePhone,
            password: hashedPassword,
            role: 'OWNER',
        });

        business.owner = user._id;
        await business.save();

        const token = generateToken(user);

        return res.status(201).json({
            success: true,
            message: 'Business registered successfully',

            data: {
                token,

                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    businessId: user.businessId,
                },

                business: {
                    id: business._id,
                    businessName: business.businessName,
                },
            },
        });
    } catch (error) {
        if (createdBusinessId) {
            await Business.deleteOne({ _id: createdBusinessId, owner: null }).catch(() => {});
        }

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists',
            });
        }

        console.error('Register error:', error);

        return res.status(500).json({
            success: false,
            message: 'Registration failed',
        });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required',
            });
        }

        if (password.length > 128) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const user = await User.findOne({
            email: normalizedEmail,
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Your account is inactive',
            });
        }

        const business = await Business.findById(
            user.businessId
        ).select(
            'businessName email phone address gstin isActive'
        );

        if (!business || !business.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Your business account is inactive or disabled',
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
            });
        }

        const token = generateToken(user);

        return res.status(200).json({
            success: true,
            message: 'Login successful',

            data: {
                token,

                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    businessId: user.businessId,
                },

                business: {
                    _id: business._id,
                    businessName: business.businessName,
                    email: business.email,
                    phone: business.phone,
                    address: business.address,
                    gstin: business.gstin,
                },
            },
        });
    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            success: false,
            message: 'Login failed',
        });
    }
};

const getMe = async (req, res) => {
    try {
        const user = await User.findById(
            req.user.userId
        ).select('-password');

        if (!user || !user.isActive) {
            return res.status(404).json({
                success: false,
                message: 'User not found or inactive',
            });
        }

        const business = await Business.findById(
            user.businessId
        ).select(
            'businessName email phone address gstin isActive'
        );

        if (!business || !business.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Business account is inactive or disabled',
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                user,
                business: {
                    _id: business._id,
                    businessName: business.businessName,
                    email: business.email,
                    phone: business.phone,
                    address: business.address,
                    gstin: business.gstin,
                },
            },
        });
    } catch (error) {
        console.error('Get me error:', error);

        return res.status(500).json({
            success: false,
            message: 'Failed to get user information',
        });
    }
};

module.exports = {
    register,
    login,
    getMe
};