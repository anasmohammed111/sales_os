const express = require('express');

const {
    createLead,
    getLeads,
    getLeadById,
    updateLead,
    archiveLead,
} = require('../controllers/leadController');

const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Protect every lead endpoint
router.use(authMiddleware);

// Create a lead
router.post('/', createLead);

// Get all leads, including supported filters
router.get('/', getLeads);

// Get one lead by ID
router.get('/:id', getLeadById);

// Update a lead
router.patch('/:id', updateLead);

// Archive a lead
router.delete('/:id', archiveLead);

module.exports = router;