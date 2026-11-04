const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const settings = require('../controllers/settingsController');
const { uploadSingle } = require('../services/storage/uploads');

const router = express.Router();

router.get('/logo/:businessId', settings.getBusinessLogo);

router.use(authMiddleware);

router.get('/', settings.getSettings);
router.patch('/profile', settings.updateProfile);
router.patch('/business', settings.updateBusiness);
router.post('/business/logo', uploadSingle, settings.uploadBusinessLogo);
router.delete('/business/logo', settings.removeBusinessLogo);
router.post('/password', settings.changePassword);

module.exports = router;
