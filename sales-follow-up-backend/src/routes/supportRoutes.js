const express = require('express');
const support = require('../controllers/supportController');

// Kelto support sessions, tenant side. Neither route uses authMiddleware:
// exchange is the way in (a single-use code), end is always allowed.
const router = express.Router();

router.post('/exchange', support.exchange);
router.post('/end', support.end);

module.exports = router;
