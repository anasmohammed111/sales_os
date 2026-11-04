const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { getSummary } = require('../controllers/homeDashboardController');

const router = express.Router();

router.get('/summary', authMiddleware, getSummary);

module.exports = router;
