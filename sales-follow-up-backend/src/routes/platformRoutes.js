const express = require('express');
const platform = require('../controllers/platformController');
const { requirePlatformAdmin } = require('../middleware/platformAuth');

// Super admin console. No route here creates, promotes or lists super admins:
// they are managed only with scripts/create-super-admin.js.
const router = express.Router();

router.post('/auth/login', platform.login);

router.use(requirePlatformAdmin);
router.get('/auth/me', platform.me);
router.get('/workspaces', platform.listWorkspaces);
router.get('/workspaces/:id', platform.getWorkspace);
router.patch('/workspaces/:id/features', platform.updateFeatures);
router.post('/workspaces/:id/view', platform.openWorkspace);
router.get('/users', platform.listUsers);
router.get('/audit', platform.listAudit);

module.exports = router;
