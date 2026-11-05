const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/access');
const pipelines = require('../controllers/pipelineSettingsController');

const router = express.Router();

router.use(authMiddleware);

// Everyone who signs in needs the stage names and colours; changing them is for pipeline admins
router.get('/', pipelines.getPipelines);
router.post('/', requirePermission('settings.pipelines'), pipelines.createPipeline);
router.patch('/:id', requirePermission('settings.pipelines'), pipelines.updatePipeline);
router.delete('/:id', requirePermission('settings.pipelines'), pipelines.deletePipeline);

module.exports = router;
