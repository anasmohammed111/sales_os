
const express = require('express');
const router = express.Router();

const {
    getPipeline,
    updatePipelineStatus
} = require('../controllers/pipelineController');

const authMiddleware = require('../middleware/authMiddleware');

router.get('/', authMiddleware, getPipeline);

router.patch('/:leadId/status', authMiddleware, updatePipelineStatus);

module.exports = router;
