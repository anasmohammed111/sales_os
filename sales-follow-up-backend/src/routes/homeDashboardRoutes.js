const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/access');
const { getSummary } = require('../controllers/homeDashboardController');

const router = express.Router();

router.get('/summary', authMiddleware, requirePermission('dashboard.view'), getSummary);

module.exports = router;
