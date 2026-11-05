const AdmissionActivity = require('../../models/AdmissionActivity');

/**
 * Appends one entry to an application's timeline. During a Kelto support
 * session the entry names the support administrator and is never attributed
 * to a workspace user.
 */
const logActivity = ({ req, application, type, message = '', body = '', meta = {} }) => {
    const support = req?.user?.support;
    return AdmissionActivity.create({
        businessId: application.businessId,
        applicationId: application._id,
        actorId: support && req.user.syntheticProfile ? null : req?.user?.userId ?? null,
        type,
        message: (support && req.user.syntheticProfile ? `Kelto support (${support.adminName}): ${message}` : message).slice(0, 500),
        body,
        meta: support ? { ...meta, supportSessionId: support.sessionId, platformAdminId: support.platformAdminId } : meta,
    });
};

module.exports = { logActivity };
