const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmissions } = require('../services/admissions/access');
const { getContext } = require('../controllers/admissions/contextController');
const applications = require('../controllers/admissions/applicationController');
const workflow = require('../controllers/admissions/workflowController');
const tasks = require('../controllers/admissions/taskController');
const documents = require('../controllers/admissions/documentController');
const payments = require('../controllers/admissions/paymentController');
const exportsController = require('../controllers/admissions/exportController');
const { getDashboard } = require('../controllers/admissions/dashboardController');
const { listAssessments } = require('../controllers/admissions/assessmentController');
const settings = require('../controllers/admissions/settingsController');
const { serveFile } = require('../controllers/admissions/fileController');
const { uploadSingle } = require('../services/storage/uploads');
const { requirePermission: needs } = require('../services/access');

const router = express.Router();

// Short-lived signed file links open in a new tab, so they carry their own
// token instead of an Authorization header. Must stay above the auth middleware.
router.get('/files/:token', serveFile);

// Every admissions route: signed in, and the business has the module enabled
router.use(authMiddleware, requireAdmissions);

router.get('/context', needs('admissions.view'), getContext);
router.get('/dashboard', needs('admissions.view'), getDashboard);
router.get('/settings', needs('admissions.settings'), settings.getSettings);
router.put('/settings', needs('admissions.settings'), settings.updateSettings);
router.get('/universities', needs('admissions.view'), settings.listUniversities);
router.post('/universities', needs('admissions.settings'), settings.createUniversity);
router.patch('/universities/:id', needs('admissions.settings'), settings.updateUniversity);

router.post('/applications/check-duplicates', needs('admissions.create'), applications.checkDuplicates);
router.get('/applications', needs('admissions.view'), applications.listApplications);
router.get('/applications/export', needs('admissions.export'), exportsController.exportApplications);
router.post('/applications', needs('admissions.create'), applications.createApplication);
router.get('/applications/:id', needs('admissions.view'), applications.getApplication);
router.patch('/applications/:id', needs('admissions.edit'), applications.updateApplication);
router.patch('/applications/:id/assign', needs('admissions.assign'), applications.assignApplication);
router.patch('/applications/:id/status', needs('admissions.close'), applications.updateApplicationStatus);
router.patch('/applications/:id/checklist/:itemKey', needs('admissions.edit'), workflow.updateChecklistItem);
router.post('/applications/:id/stage', needs('admissions.move'), workflow.changeStage);
router.post('/applications/:id/visa-outcome', needs('admissions.edit'), workflow.recordVisaOutcome);
router.get('/applications/:id/activity', needs('admissions.view'), workflow.listActivity);
router.post('/applications/:id/notes', needs('admissions.edit'), workflow.addNote);
router.get('/applications/:id/tasks', needs('admissions.view'), tasks.listApplicationTasks);
router.post('/applications/:id/tasks', needs('admissions.edit'), tasks.createTask);

router.get('/applications/:id/documents', needs('admissions.view'), documents.listDocuments);
router.post('/applications/:id/documents', needs('admissions.documents'), documents.createDocument);
router.patch('/documents/:docId', needs('admissions.documents'), documents.updateDocument);
router.post('/documents/:docId/file', needs('admissions.documents'), uploadSingle, documents.uploadDocumentFile);
router.patch('/documents/:docId/review', needs('admissions.documents'), documents.reviewDocument);
router.get('/documents/:docId/download-url', needs('admissions.view'), documents.getDownloadUrl);

router.get('/applications/:id/fees', needs('admissions.payments'), payments.listFees);
router.post('/applications/:id/fees', needs('admissions.record_payments'), payments.createFee);
router.patch('/fees/:feeId', needs('admissions.record_payments'), payments.updateFee);
router.post('/fees/:feeId/transactions', needs('admissions.record_payments'), uploadSingle, payments.recordPayment);
router.patch('/fees/:feeId/transactions/:txId/void', needs('admissions.record_payments'), payments.voidPayment);
router.get('/fees/:feeId/transactions/:txId/receipt-url', needs('admissions.payments'), payments.getReceiptUrl);
router.get('/payments', needs('admissions.payments'), payments.listPayments);
router.get('/payments/export', needs('admissions.payments', 'admissions.export'), exportsController.exportPayments);

router.get('/assessments', needs('admissions.view'), listAssessments);

router.get('/tasks', needs('admissions.view'), tasks.listTasks);
router.patch('/tasks/:id', needs('admissions.edit'), tasks.updateTask);

module.exports = router;
