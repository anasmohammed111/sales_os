const express = require('express');

const {
    register,
    login,
    googleAuth,
    forgotPassword,
    resetPassword,
    getMe,
} = require('../controllers/authController');

const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);

router.post('/login', login);

router.post('/google', googleAuth);

router.post('/forgot-password', forgotPassword);

router.post('/reset-password', resetPassword);

router.get(
    '/me',
    authMiddleware,
    getMe
);

module.exports = router;