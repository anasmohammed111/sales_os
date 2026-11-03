const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmissions } = require('../services/admissions/access');
const { getContext } = require('../controllers/admissions/contextController');

const router = express.Router();

// Every admissions route: signed in, and the business has the module enabled
router.use(authMiddleware, requireAdmissions);

router.get('/context', getContext);

module.exports = router;
