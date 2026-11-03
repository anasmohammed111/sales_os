const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmissions } = require('../services/admissions/access');
const { getContext } = require('../controllers/admissions/contextController');
const applications = require('../controllers/admissions/applicationController');
const workflow = require('../controllers/admissions/workflowController');
const tasks = require('../controllers/admissions/taskController');

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
router.patch('/applications/:id/checklist/:itemKey', workflow.updateChecklistItem);
router.post('/applications/:id/stage', workflow.changeStage);
router.post('/applications/:id/visa-outcome', workflow.recordVisaOutcome);
router.get('/applications/:id/activity', workflow.listActivity);
router.post('/applications/:id/notes', workflow.addNote);
router.get('/applications/:id/tasks', tasks.listApplicationTasks);
router.post('/applications/:id/tasks', tasks.createTask);

router.get('/tasks', tasks.listTasks);
router.patch('/tasks/:id', tasks.updateTask);

module.exports = router;
