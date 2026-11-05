const mongoose = require('mongoose');
const AdmissionFee = require('../../models/AdmissionFee');
const AdmissionApplication = require('../../models/AdmissionApplication');
const { FEE_STATUSES } = require('../../models/AdmissionFee');
const { PAYMENT_CATEGORIES } = require('../../services/admissions/defaultConfig');
const { CURRENCIES, parseMoney, formatMinor } = require('../../services/admissions/money');
const { summarize, refreshApplicationPayments } = require('../../services/admissions/payments');
const { findApplicationInScope } = require('../../services/admissions/access');
const { buildApplicationQuery, toDate } = require('../../services/admissions/filters');
const { logActivity } = require('../../services/admissions/activity');
const reminders = require('../../services/admissions/reminders');
const { storeUpload, issueFileLink } = require('../../services/storage/uploads');
const { findFee } = require('../../services/admissions/feeRules');
const { feeFromEntry, autoCompleteHeldItems, planFor, amountText } = require('../../services/admissions/feeSchedule');

const CATEGORY_NAMES = {
    SERVICE_FEE: 'Service fee',
    STUDENT_EXPENSE: 'Student expense',
    UNIVERSITY_FEE: 'University fee',
};

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const serializeSummary = (rows) =>
    rows.map((r) => ({
        ...r,
        due: formatMinor(r.dueMinor),
        paid: formatMinor(r.paidMinor),
        outstanding: formatMinor(r.outstandingMinor),
    }));

const serializeFee = (fee, now = new Date()) => ({
    id: fee._id,
    applicationId: fee.applicationId,
    category: fee.category,
    label: fee.label || CATEGORY_NAMES[fee.category],
    currency: fee.currency,
    amountDueMinor: fee.amountDueMinor,
    amountDue: formatMinor(fee.amountDueMinor),
    paidMinor: fee.paidMinor,
    paid: formatMinor(fee.paidMinor),
    outstandingMinor: fee.outstandingMinor,
    outstanding: formatMinor(fee.outstandingMinor),
    status: fee.status,
    needsAmount: fee.needsAmount === true,
    scheduleKey: fee.scheduleKey || null,
    stageKey: fee.stageKey || null,
    refundable: fee.refundable === true,
    dueDate: fee.dueDate,
    isOverdue: Boolean(fee.dueDate && fee.outstandingMinor > 0 && fee.dueDate < now),
    notes: fee.notes,
    transactions: fee.transactions.map((t) => ({
        id: t._id,
        amountMinor: t.amountMinor,
        amount: formatMinor(t.amountMinor),
        paidAt: t.paidAt,
        reference: t.reference,
        method: t.method,
        hasReceipt: Boolean(t.receipt?.storageKey),
        receiptName: t.receipt?.originalName || '',
        recordedBy: t.recordedBy?.name ? { id: t.recordedBy._id, name: t.recordedBy.name } : null,
        recordedAt: t.recordedAt,
        isVoided: t.isVoided,
        voidReason: t.voidReason,
    })),
    createdAt: fee.createdAt,
});

const afterChange = async (req, application) => {
    await refreshApplicationPayments(application._id);
    // Items that only waited for this money are ticked (and may add their own fees)
    await autoCompleteHeldItems({ req, applicationId: application._id, config: req.admissionsConfig });
    await reminders.syncRemindersForApplication(application._id);
};

const findFeeInScope = async (req, id) => {
    if (!mongoose.isValidObjectId(id)) return null;
    const fee = await AdmissionFee.findOne({ _id: id, businessId: req.user.businessId, isArchived: { $ne: true } });
    if (!fee) return null;
    const application = await findApplicationInScope(req, fee.applicationId);
    return application ? { fee, application } : null;
};

const respondFee = async (res, fee, status = 200) => {
    await fee.populate('transactions.recordedBy', 'name');
    return res.status(status).json({ success: true, data: serializeFee(fee) });
};

const parseDueDate = (value) => {
    if (value === undefined) return { skip: true };
    if (value === null || value === '') return { value: null };
    const date = toDate(value);
    return date ? { value: date } : { error: 'Invalid due date' };
};

const listFees = async (req, res, next) => {
    try {
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        const fees = await AdmissionFee.find({ businessId: req.user.businessId, applicationId: application._id, isArchived: { $ne: true } })
            .sort({ createdAt: 1 })
            .populate('transactions.recordedBy', 'name');

        return res.json({
            success: true,
            data: {
                fees: fees.map((f) => serializeFee(f)),
                summary: serializeSummary(summarize(fees)),
                // Fee-list entries not on the student: coming up, missed, optional
                plan: planFor(application, req.admissionsConfig, fees),
            },
        });
    } catch (error) {
        next(error);
    }
};

/** A fee from the fee list, added by hand (optional fees, or ones the student missed). */
const createFromFeeList = async (req, res, application, body) => {
    const entry = findFee(req.admissionsConfig, body.scheduleKey);
    if (!entry || entry.isArchived) return fail(res, 400, 'That fee is not in the fee list');

    const values = feeFromEntry(entry, {
        businessId: req.user.businessId,
        applicationId: application._id,
        userId: req.user.userId,
    });
    if (body.amountDue !== undefined && body.amountDue !== null && body.amountDue !== '') {
        const amount = parseMoney(body.amountDue);
        if (!amount.ok) return fail(res, 400, amount.message);
        Object.assign(values, { amountDueMinor: amount.minor, needsAmount: false });
    }
    const due = parseDueDate(body.dueDate);
    if (due.error) return fail(res, 400, due.error);
    if (!due.skip) values.dueDate = due.value;

    let fee;
    try {
        fee = await AdmissionFee.create(values);
    } catch (error) {
        if (error.code === 11000) return fail(res, 409, `${entry.name} is already on this student's payments`);
        throw error;
    }

    await afterChange(req, application);
    await logActivity({
        req,
        application,
        type: 'FEE_ADDED',
        message: `${fee.label} added from the fee list: ${amountText(fee)}`,
        meta: { feeId: fee._id, scheduleKey: fee.scheduleKey },
    });
    return respondFee(res, fee, 201);
};

const createFee = async (req, res, next) => {
    try {
        const body = req.body || {};
        const { category, label, amountDue, currency, dueDate, notes, refundable } = body;
        const application = await findApplicationInScope(req, req.params.id);
        if (!application) return fail(res, 404, 'Student application not found');

        if (body.scheduleKey) return await createFromFeeList(req, res, application, body);

        if (!PAYMENT_CATEGORIES.includes(category)) return fail(res, 400, 'Choose service fee, student expense or university fee');
        if (!CURRENCIES.includes(currency)) return fail(res, 400, `Currency must be one of ${CURRENCIES.join(', ')}`);
        const amount = parseMoney(amountDue);
        if (!amount.ok) return fail(res, 400, amount.message);
        const due = parseDueDate(dueDate);
        if (due.error) return fail(res, 400, due.error);

        const fee = await AdmissionFee.create({
            businessId: req.user.businessId,
            applicationId: application._id,
            category,
            label: typeof label === 'string' ? label.trim().slice(0, 120) : '',
            amountDueMinor: amount.minor,
            currency,
            dueDate: due.skip ? null : due.value,
            notes: typeof notes === 'string' ? notes.trim().slice(0, 1000) : '',
            refundable: typeof refundable === 'boolean' ? refundable : category === 'SERVICE_FEE',
            createdBy: req.user.userId,
        });

        await afterChange(req, application);
        await logActivity({
            req,
            application,
            type: 'FEE_ADDED',
            message: `${fee.label || CATEGORY_NAMES[category]} added: ${formatMinor(amount.minor)} ${currency}`,
            meta: { feeId: fee._id },
        });

        return respondFee(res, fee, 201);
    } catch (error) {
        next(error);
    }
};

const updateFee = async (req, res, next) => {
    try {
        const { label, amountDue, currency, dueDate, notes, isArchived } = req.body || {};
        const found = await findFeeInScope(req, req.params.feeId);
        if (!found) return fail(res, 404, 'Fee not found');
        const { fee, application } = found;

        if (amountDue !== undefined) {
            const amount = parseMoney(amountDue);
            if (!amount.ok) return fail(res, 400, amount.message);
            if (amount.minor < fee.paidMinor) return fail(res, 400, 'Amount due cannot be less than what has already been paid');
            fee.amountDueMinor = amount.minor;
            fee.needsAmount = false;
        }

        if (currency !== undefined && currency !== fee.currency) {
            if (!CURRENCIES.includes(currency)) return fail(res, 400, `Currency must be one of ${CURRENCIES.join(', ')}`);
            if (fee.transactions.some((t) => !t.isVoided)) {
                return fail(res, 400, 'Currency cannot change after payments have been recorded');
            }
            fee.currency = currency;
        }

        const due = parseDueDate(dueDate);
        if (due.error) return fail(res, 400, due.error);
        if (!due.skip) fee.dueDate = due.value;
        if (typeof label === 'string') fee.label = label.trim().slice(0, 120);
        if (typeof notes === 'string') fee.notes = notes.trim().slice(0, 1000);
        if (isArchived === true) {
            if (fee.transactions.some((t) => !t.isVoided)) return fail(res, 400, 'Void the payments before removing this fee');
            fee.isArchived = true;
        }

        await fee.save();
        await afterChange(req, application);
        await logActivity({
            req,
            application,
            type: 'FEE_UPDATED',
            message: `${fee.label || CATEGORY_NAMES[fee.category]} ${fee.isArchived ? 'removed' : 'updated'}`,
            meta: { feeId: fee._id },
        });

        return respondFee(res, fee);
    } catch (error) {
        next(error);
    }
};

const recordPayment = async (req, res, next) => {
    try {
        const { amount, paidAt, reference, method } = req.body || {};
        const found = await findFeeInScope(req, req.params.feeId);
        if (!found) return fail(res, 404, 'Fee not found');
        const { fee, application } = found;

        if (fee.needsAmount) return fail(res, 400, `Set the amount for ${fee.label || 'this fee'} first`);
        const parsed = parseMoney(amount);
        if (!parsed.ok) return fail(res, 400, parsed.message);
        if (parsed.minor > fee.outstandingMinor) {
            return fail(
                res,
                400,
                `This payment is more than the outstanding balance (${formatMinor(fee.outstandingMinor)} ${fee.currency})`
            );
        }

        const date = toDate(paidAt);
        if (!date) return fail(res, 400, 'Choose the payment date');
        if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) return fail(res, 400, 'The payment date cannot be in the future');

        let receipt;
        if (req.file) {
            const stored = await storeUpload({ file: req.file, businessId: req.user.businessId, applicationId: application._id });
            if (stored.error) return fail(res, stored.status, stored.error);
            const { storageKey, originalName, mimeType, size } = stored.file;
            receipt = { storageKey, originalName, mimeType, size };
        }

        fee.transactions.push({
            amountMinor: parsed.minor,
            paidAt: date,
            reference: typeof reference === 'string' ? reference.trim().slice(0, 120) : '',
            method: typeof method === 'string' ? method.trim().slice(0, 60) : '',
            ...(receipt && { receipt }),
            recordedBy: req.user.userId,
        });
        await fee.save();

        await afterChange(req, application);
        await logActivity({
            req,
            application,
            type: 'PAYMENT_RECORDED',
            message: `Payment of ${formatMinor(parsed.minor)} ${fee.currency} recorded for ${fee.label || CATEGORY_NAMES[fee.category]}`,
            meta: { feeId: fee._id },
        });

        return respondFee(res, fee);
    } catch (error) {
        next(error);
    }
};

const voidPayment = async (req, res, next) => {
    try {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
        const found = await findFeeInScope(req, req.params.feeId);
        if (!found) return fail(res, 404, 'Fee not found');
        const { fee, application } = found;

        const tx = mongoose.isValidObjectId(req.params.txId) ? fee.transactions.id(req.params.txId) : null;
        if (!tx) return fail(res, 404, 'Payment not found');
        if (tx.isVoided) return fail(res, 409, 'This payment is already voided');
        if (reason.length < 3) return fail(res, 400, 'Give a reason for voiding the payment');

        tx.isVoided = true;
        tx.voidReason = reason;
        tx.voidedBy = req.user.userId;
        tx.voidedAt = new Date();
        await fee.save();

        await afterChange(req, application);
        await logActivity({
            req,
            application,
            type: 'PAYMENT_VOIDED',
            message: `Payment of ${formatMinor(tx.amountMinor)} ${fee.currency} voided: ${reason}`,
            meta: { feeId: fee._id, txId: tx._id },
        });

        return respondFee(res, fee);
    } catch (error) {
        next(error);
    }
};

const getReceiptUrl = async (req, res, next) => {
    try {
        const found = await findFeeInScope(req, req.params.feeId);
        if (!found) return fail(res, 404, 'Fee not found');
        const tx = mongoose.isValidObjectId(req.params.txId) ? found.fee.transactions.id(req.params.txId) : null;
        if (!tx?.receipt?.storageKey) return fail(res, 404, 'No receipt for this payment');

        const link = await issueFileLink({
            claims: {
                kind: 'receipt',
                feeId: String(found.fee._id),
                txId: String(tx._id),
                businessId: String(found.fee.businessId),
            },
            storageKey: tx.receipt.storageKey,
            filename: tx.receipt.originalName,
            mimeType: tx.receipt.mimeType,
        });
        return res.json({ success: true, data: link });
    } catch (error) {
        next(error);
    }
};

/**
 * Fee rows for the payment tracker and its export. Application filters
 * (search, intake, counsellor, ...) come from the shared builder; fee
 * filters: category, status (incl. OVERDUE / OUTSTANDING), dueFrom/dueTo.
 */
const queryPaymentRows = async (req, query, now = new Date()) => {
    const { filter } = await buildApplicationQuery(
        req,
        { ...query, status: query.applicationStatus || 'ALL', paymentStatus: undefined },
        req.admissionsConfig,
        now
    );
    const applications = await AdmissionApplication.find(filter)
        .select('student counsellorId intakeMonth intakeYear studyLevel currentStageKey status')
        .populate('counsellorId', 'name')
        .limit(5000);
    const byId = new Map(applications.map((a) => [String(a._id), a]));

    const feeFilter = {
        businessId: req.user.businessId,
        applicationId: { $in: applications.map((a) => a._id) },
        isArchived: { $ne: true },
    };
    if (PAYMENT_CATEGORIES.includes(query.category)) feeFilter.category = query.category;

    const status = typeof query.status === 'string' ? query.status.toUpperCase() : '';
    if (FEE_STATUSES.includes(status)) feeFilter.status = status;
    if (status === 'OUTSTANDING') feeFilter.outstandingMinor = { $gt: 0 };
    if (status === 'OVERDUE') Object.assign(feeFilter, { outstandingMinor: { $gt: 0 }, dueDate: { $lt: now } });

    const dueFrom = toDate(query.dueFrom);
    const dueTo = toDate(query.dueTo);
    if (dueFrom || dueTo) {
        feeFilter.dueDate = { ...(feeFilter.dueDate || {}), ...(dueFrom && { $gte: dueFrom }), ...(dueTo && { $lte: dueTo }) };
    }

    const fees = await AdmissionFee.find(feeFilter).sort({ dueDate: 1, createdAt: 1 });
    return { fees, applicationsById: byId };
};

const serializePaymentRow = (fee, application, now) => ({
    ...serializeFee(fee, now),
    transactions: undefined,
    paymentCount: fee.transactions.filter((t) => !t.isVoided).length,
    student: application ? { name: application.student.name, phone: application.student.phone } : null,
    counsellor: application?.counsellorId?.name ? { id: application.counsellorId._id, name: application.counsellorId.name } : null,
    intakeMonth: application?.intakeMonth,
    intakeYear: application?.intakeYear,
    studyLevel: application?.studyLevel,
});

const listPayments = async (req, res, next) => {
    try {
        const now = new Date();
        const { fees, applicationsById } = await queryPaymentRows(req, req.query, now);
        return res.json({
            success: true,
            data: {
                items: fees.map((f) => serializePaymentRow(f, applicationsById.get(String(f.applicationId)), now)),
                totals: serializeSummary(summarize(fees)),
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    CATEGORY_NAMES,
    listFees,
    createFee,
    updateFee,
    recordPayment,
    voidPayment,
    getReceiptUrl,
    listPayments,
    queryPaymentRows,
    serializePaymentRow,
};
