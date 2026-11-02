const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token is required',
            });
        }

        const [scheme, token] = authHeader.split(' ');

        if (
            scheme !== 'Bearer' ||
            !token
        ) {
            return res.status(401).json({
                success: false,
                message: 'Invalid authorization format',
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error('CRITICAL: JWT_SECRET environment variable is not configured');
            return res.status(500).json({
                success: false,
                message: 'Authentication service misconfigured',
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        if (!decoded || !decoded.userId || !decoded.businessId || !decoded.role) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token claims',
            });
        }

        req.user = {
            userId: decoded.userId.toString(),
            businessId: decoded.businessId.toString(),
            role: decoded.role,
        };

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token',
        });
    }
};

module.exports = authMiddleware;