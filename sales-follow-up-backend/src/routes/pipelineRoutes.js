
const express = require('express');
const router = express.Router();

const {
    getPipeline,
    updatePipelineStatus
} = require('../controllers/pipelineController');

const authMiddleware = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/access');

router.get('/', authMiddleware, requirePermission('pipeline.view'), getPipeline);

router.patch('/:leadId/status', authMiddleware, requirePermission('pipeline.move'), updatePipelineStatus);

module.exports = router;
