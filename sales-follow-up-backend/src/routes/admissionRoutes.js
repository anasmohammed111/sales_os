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
const { serveFile } = require('../controllers/admissions/fileController');
const { uploadSingle } = require('../services/storage/uploads');

const router = express.Router();

// Short-lived signed file links open in a new tab, so they carry their own
// token instead of an Authorization header. Must stay above the auth middleware.
router.get('/files/:token', serveFile);

// Every admissions route: signed in, and the business has the module enabled
router.use(authMiddleware, requireAdmissions);

router.get('/context', getContext);
router.get('/dashboard', getDashboard);

router.post('/applications/check-duplicates', applications.checkDuplicates);
router.get('/applications', applications.listApplications);
router.get('/applications/export', exportsController.exportApplications);
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

router.get('/applications/:id/documents', documents.listDocuments);
router.post('/applications/:id/documents', documents.createDocument);
router.patch('/documents/:docId', documents.updateDocument);
router.post('/documents/:docId/file', uploadSingle, documents.uploadDocumentFile);
router.patch('/documents/:docId/review', documents.reviewDocument);
router.get('/documents/:docId/download-url', documents.getDownloadUrl);

router.get('/applications/:id/fees', payments.listFees);
router.post('/applications/:id/fees', payments.createFee);
router.patch('/fees/:feeId', payments.updateFee);
router.post('/fees/:feeId/transactions', uploadSingle, payments.recordPayment);
router.patch('/fees/:feeId/transactions/:txId/void', payments.voidPayment);
router.get('/fees/:feeId/transactions/:txId/receipt-url', payments.getReceiptUrl);
router.get('/payments', payments.listPayments);
router.get('/payments/export', exportsController.exportPayments);

router.get('/tasks', tasks.listTasks);
router.patch('/tasks/:id', tasks.updateTask);

module.exports = router;
