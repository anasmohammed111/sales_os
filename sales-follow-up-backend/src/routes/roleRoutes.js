const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const roles = require('../controllers/roleController');

const router = express.Router();

router.use(authMiddleware);

// The permissions a role can have (for the Roles screen)
router.get('/catalog', roles.getCatalog);
// People I may assign leads, follow-ups, quotations or students to
router.get('/assignable/:module', roles.listAssignable);

router.get('/', roles.listRoles);
router.post('/', roles.createRole);
router.patch('/:id', roles.updateRole);
router.delete('/:id', roles.deleteRole);

module.exports = router;
