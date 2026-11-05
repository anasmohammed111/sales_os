const express = require('express');
const platform = require('../controllers/platformController');
const admins = require('../controllers/platformAdminController');
const { requirePlatformAdmin, requirePlatformPermission: can } = require('../middleware/platformAuth');

// Kelto admin app API. Every route checks the administrator's role on the
// server; the app only hides what a role cannot do.
const router = express.Router();

router.post('/auth/login', platform.login);

router.use(requirePlatformAdmin);
router.get('/auth/me', platform.me);
router.post('/auth/change-password', platform.changePassword);

// Companies
router.get('/workspaces', can('companies.view'), platform.listWorkspaces);
router.get('/workspaces/:id', can('companies.view'), platform.getWorkspace);
router.patch('/workspaces/:id/features', can('modules.manage'), platform.updateFeatures);
router.post('/workspaces/:id/suspend', can('companies.lifecycle'), platform.suspendWorkspace);
router.post('/workspaces/:id/reactivate', can('companies.lifecycle'), platform.reactivateWorkspace);
router.get('/users', can('companies.view'), platform.listUsers);

// Support sessions (support edits additionally need support.edit, checked inside)
router.post('/workspaces/:id/support-sessions', can('support.view'), platform.startSupportSession);
router.get('/support-sessions', can('sessions.view'), platform.listSupportSessions);
router.post('/support-sessions/:id/revoke', platform.revokeSupportSession);
router.get('/support/edit-options', can('support.edit'), platform.supportEditOptions);

// Platform administrators
router.get('/roles', can('admins.view'), admins.listRoles);
router.get('/admins', can('admins.view'), admins.listAdmins);
router.post('/admins', can('admins.manage'), admins.createAdmin);
router.patch('/admins/:id', can('admins.manage'), admins.updateAdmin);
router.post('/admins/:id/reset-password', can('admins.manage'), admins.resetPassword);
router.post('/admins/:id/revoke-sessions', admins.revokeSessions);
router.get('/admins/:id/logins', can('admins.view'), admins.loginHistory);

// Audit
router.get('/audit', can('audit.view'), platform.listAudit);

module.exports = router;
