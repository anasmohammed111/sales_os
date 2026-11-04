const express = require('express');

const {
    createLead,
    getLeads,
    getLeadById,
    updateLead,
    archiveLead,
} = require('../controllers/leadController');

const authMiddleware = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/access');

const router = express.Router();

// Protect every lead endpoint
router.use(authMiddleware);

// Create a lead
router.post('/', requirePermission('leads.create'), createLead);

// Get all leads, including supported filters
router.get('/', requirePermission('leads.view'), getLeads);

// Get one lead by ID
router.get('/:id', requirePermission('leads.view'), getLeadById);

// Update a lead
router.patch('/:id', requirePermission('leads.edit'), updateLead);

// Archive a lead
router.delete('/:id', requirePermission('leads.archive'), archiveLead);

module.exports = router;