
const express = require('express');
const router = express.Router();

const {
    createQuotation,
    getQuotations,
    getQuotationById,
    updateQuotation,
    updateQuotationStatus,
    deleteQuotation,
} = require('../controllers/quotationController');

const authMiddleware = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/access');

router.use(authMiddleware);

router.post('/', requirePermission('quotations.create'), createQuotation);
router.get('/', requirePermission('quotations.view'), getQuotations);
router.get('/:id', requirePermission('quotations.view'), getQuotationById);
router.put('/:id', requirePermission('quotations.edit'), updateQuotation);
router.patch('/:id/status', requirePermission('quotations.status'), updateQuotationStatus);
router.delete('/:id', requirePermission('quotations.delete'), deleteQuotation);

module.exports = router;
