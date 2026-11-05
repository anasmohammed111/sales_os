const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const Business = require('../models/Business');
const { generateToken } = require('../services/authService');
const { sendMail } = require('../services/mailer');
const { loadAccess, publicAccess, ensureDefaultRoles, invalidateAccess } = require('../services/access');

/** What a person may do, sent with every sign-in so the app can show the right buttons */
const accessFor = async (user) => {
    const access = await loadAccess(user._id.toString(), user.businessId.toString());
    return access ? publicAccess({ user: access }) : null;
};

/** A new business gets the built-in roles, and its owner the Owner role */
const giveOwnerRole = async (business, owner) => {
    const roles = await ensureDefaultRoles(business._id);
    owner.roleId = roles.get('OWNER')._id;
    await owner.save();
    invalidateAccess(owner._id);
};

const googleClient = new OAuth2Client();

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
        await giveOwnerRole(business, user);

        const token = generateToken(user);
        const access = await accessFor(user);

        return res.status(201).json({
            success: true,
            message: 'Business registered successfully',

            data: {
                token,
                access,

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

        // Accounts created with Google have no password
        if (!user.password) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
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
        const access = await accessFor(user);

        return res.status(200).json({
            success: true,
            message: 'Login successful',

            data: {
                token,
                access,

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

/**
 * Sign in or register with a Google ID token (from Google Identity Services).
 * Existing users (matched by Google ID, then by verified email) are logged in.
 * New users must also send businessName; without it the response is
 * 404 GOOGLE_SIGNUP_REQUIRED so the client can ask for it.
 */
const googleAuth = async (req, res) => {
    let createdBusinessId = null;

    try {
        const { credential, businessName, phone } = req.body || {};

        if (!process.env.GOOGLE_CLIENT_ID) {
            console.error('CRITICAL: GOOGLE_CLIENT_ID environment variable is not configured');
            return res.status(500).json({
                success: false,
                message: 'Google sign-in is not configured',
            });
        }

        if (
            typeof credential !== 'string' ||
            !credential ||
            credential.length > 4096
        ) {
            return res.status(400).json({
                success: false,
                message: 'Google credential is required',
            });
        }

        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            payload = ticket.getPayload();
        } catch (error) {
            return res.status(401).json({
                success: false,
                message: 'Google sign-in failed. Please try again.',
            });
        }

        if (
            !payload ||
            !payload.sub ||
            !payload.email ||
            payload.email_verified !== true
        ) {
            return res.status(401).json({
                success: false,
                message: 'Your Google email address is not verified',
            });
        }

        const googleId = payload.sub;
        const normalizedEmail = payload.email.trim().toLowerCase();

        const user =
            (await User.findOne({ googleId })) ||
            (await User.findOne({ email: normalizedEmail }));

        if (user) {
            if (user.googleId && user.googleId !== googleId) {
                return res.status(401).json({
                    success: false,
                    message: 'This account is linked to a different Google account',
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

            if (!user.googleId) {
                await User.updateOne(
                    { _id: user._id },
                    { $set: { googleId } }
                );
            }

            const token = generateToken(user);
            const access = await accessFor(user);

            return res.status(200).json({
                success: true,
                message: 'Login successful',

                data: {
                    token,
                    access,

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
        }

        if (typeof businessName !== 'string' || !businessName.trim()) {
            return res.status(404).json({
                success: false,
                code: 'GOOGLE_SIGNUP_REQUIRED',
                message: 'No account found for this Google email. Enter your business name to create one.',
                data: {
                    email: normalizedEmail,
                    name: payload.name || '',
                },
            });
        }

        const trimmedBusinessName = businessName.trim();

        if (trimmedBusinessName.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Business name must not exceed 100 characters',
            });
        }

        const googleName = (payload.name || '').trim().slice(0, 100);
        const name = googleName.length >= 2
            ? googleName
            : normalizedEmail.split('@')[0].slice(0, 100);
        const safePhone = typeof phone === 'string' ? phone.trim().slice(0, 30) : '';

        const business = await Business.create({
            businessName: trimmedBusinessName,
            email: normalizedEmail,
            phone: safePhone,
        });
        createdBusinessId = business._id;

        const newUser = await User.create({
            businessId: business._id,
            name,
            email: normalizedEmail,
            phone: safePhone,
            googleId,
            role: 'OWNER',
        });

        business.owner = newUser._id;
        await business.save();
        await giveOwnerRole(business, newUser);

        const token = generateToken(newUser);
        const access = await accessFor(newUser);

        return res.status(201).json({
            success: true,
            message: 'Business registered successfully',

            data: {
                token,
                access,

                user: {
                    id: newUser._id,
                    name: newUser.name,
                    email: newUser.email,
                    phone: newUser.phone,
                    role: newUser.role,
                    businessId: newUser.businessId,
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

        console.error('Google auth error:', error);

        return res.status(500).json({
            success: false,
            message: 'Google sign-in failed',
        });
    }
};

const RESET_TTL_MS = 60 * 60 * 1000;
const FORGOT_MESSAGE = "If an account exists for that email, we've sent a link to reset the password. It works for one hour.";

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Starts a password reset. Always gives the same answer so nobody can find
 * out which emails have accounts. Only a hash of the token is stored.
 */
const forgotPassword = async (req, res) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        if (!email) {
            return res.status(400).json({ success: false, message: 'Enter your email address' });
        }

        const user = await User.findOne({ email, isActive: true });
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            await User.updateOne(
                { _id: user._id },
                { $set: { resetPasswordToken: hashToken(token), resetPasswordExpires: new Date(Date.now() + RESET_TTL_MS) } }
            );

            const appUrl = (process.env.APP_URL || 'http://localhost:4200').replace(/\/$/, '');
            const link = `${appUrl}/auth/reset-password?token=${token}`;
            const { sent } = await sendMail({
                to: user.email,
                subject: 'Reset your password',
                text: `${link}\n\nUse this link within one hour to choose a new password. If you didn't ask for this, ignore this email.`,
                html: `<p><a href="${link}">Choose a new password</a></p><p>The link works for one hour. If you didn't ask for this, ignore this email.</p>`,
            });

            if (!sent && process.env.NODE_ENV !== 'production') {
                console.log(`[Password reset] Email is not configured. Reset link for ${user.email}: ${link}`);
            } else if (!sent) {
                console.warn('[Password reset] SMTP_HOST is not set, so no reset email was sent.');
            }
        }

        return res.status(200).json({ success: true, message: FORGOT_MESSAGE });
    } catch (error) {
        console.error('Forgot password error:', error.message);
        return res.status(500).json({ success: false, message: 'Could not start the password reset' });
    }
};

/** Finishes a password reset with the token from the email. */
const resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body || {};

        if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
            return res.status(400).json({ success: false, message: 'The new password must be between 8 and 128 characters' });
        }

        const user =
            typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
                ? await User.findOne({ resetPasswordToken: hashToken(token), resetPasswordExpires: { $gt: new Date() }, isActive: true })
                : null;

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'This reset link is invalid or has expired. Ask for a new one.',
            });
        }

        user.password = await bcrypt.hash(password, 12);
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();

        return res.status(200).json({ success: true, message: 'Password changed. You can sign in now.' });
    } catch (error) {
        console.error('Reset password error:', error.message);
        return res.status(500).json({ success: false, message: 'Could not reset the password' });
    }
};

/** A super admin viewing a workspace has no user there: describe them instead. */
const platformViewProfile = (req) => ({
    _id: req.user.platformAdminId,
    id: req.user.platformAdminId,
    name: `${req.user.platformAdminName} (super admin)`,
    email: req.user.platformAdminEmail,
    role: 'OWNER',
    businessId: req.user.businessId,
    isActive: true,
    isPlatformView: true,
});

const getMe = async (req, res) => {
    try {
        if (req.user.isPlatformView) {
            const business = await Business.findById(req.user.businessId).select('businessName email phone address gstin');
            return res.status(200).json({
                success: true,
                data: { user: platformViewProfile(req), access: publicAccess(req), business },
            });
        }

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
                access: publicAccess(req),
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
    googleAuth,
    forgotPassword,
    resetPassword,
    getMe
};