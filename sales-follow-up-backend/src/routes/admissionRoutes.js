const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmissions } = require('../services/admissions/access');
const { getContext } = require('../controllers/admissions/contextController');
const applications = require('../controllers/admissions/applicationController');

const router = express.Router();

// Every admissions route: signed in, and the business has the module enabled
router.use(authMiddleware, requireAdmissions);

router.get('/context', getContext);

router.post('/applications/check-duplicates', applications.checkDuplicates);
router.get('/applications', applications.listApplications);
router.post('/applications', applications.createApplication);
router.get('/applications/:id', applications.getApplication);
router.patch('/applications/:id', applications.updateApplication);
router.patch('/applications/:id/assign', applications.assignApplication);
router.patch('/applications/:id/status', applications.updateApplicationStatus);

module.exports = router;
