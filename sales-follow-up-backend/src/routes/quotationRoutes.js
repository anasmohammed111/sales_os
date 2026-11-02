
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

router.use(authMiddleware);

router.post('/', createQuotation);
router.get('/', getQuotations);
router.get('/:id', getQuotationById);
router.put('/:id', updateQuotation);
router.patch('/:id/status', updateQuotationStatus);
router.delete('/:id', deleteQuotation);

module.exports = router;
