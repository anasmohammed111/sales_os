const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const settings = require('../controllers/settingsController');

const router = express.Router();

router.use(authMiddleware);

router.get('/', settings.getSettings);
router.patch('/profile', settings.updateProfile);
router.patch('/business', settings.updateBusiness);
router.post('/password', settings.changePassword);

module.exports = router;
