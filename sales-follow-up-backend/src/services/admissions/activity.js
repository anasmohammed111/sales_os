const AdmissionActivity = require('../../models/AdmissionActivity');

/** Appends one entry to an application's timeline. */
const logActivity = ({ req, application, type, message = '', body = '', meta = {} }) =>
    AdmissionActivity.create({
        businessId: application.businessId,
        applicationId: application._id,
        actorId: req?.user?.userId ?? null,
        type,
        message: message.slice(0, 500),
        body,
        meta,
    });

module.exports = { logActivity };
