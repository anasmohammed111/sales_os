// Runs the API on a throwaway in-memory MongoDB with synthetic SYB data.
// Never reads MONGO_URI and never touches a real database.
//   npm run dev:memory            (port 5001 — stop the normal backend first)
//   PORT=5002 npm run dev:memory  (alongside it)
// Sign in as admin@syb.test / Password123 (also manager@, anu@, rahul@, divya@).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-memory-secret';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || require('path').join(__dirname, '../storage/dev-memory');
process.env.ADMISSIONS_JOB_INTERVAL_SECONDS = process.env.ADMISSIONS_JOB_INTERVAL_SECONDS || '30';

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../src/app');
const Business = require('../src/models/Business');
const User = require('../src/models/User');
const Lead = require('../src/models/Leads');
const University = require('../src/models/University');
const FollowUp = require('../src/models/FollowUp');
const Quotation = require('../src/models/Quotation');
const AdmissionApplication = require('../src/models/AdmissionApplication');
const AdmissionFee = require('../src/models/AdmissionFee');
const AdmissionDocument = require('../src/models/AdmissionDocument');
const AdmissionActivity = require('../src/models/AdmissionActivity');
const PlatformAdmin = require('../src/models/PlatformAdmin');
const Plan = require('../src/models/Plan');
const Subscription = require('../src/models/Subscription');
const { runMigrations } = require('../src/migrations');
const { ensureConfig, getActiveStages } = require('../src/services/admissions/configService');
const { buildChecklist, setItemStatus, isApplicable, checkRule } = require('../src/services/admissions/checklist');
const { snapshotFromLead } = require('../src/services/admissions/students');
const { refreshNextFollowUp } = require('../src/services/admissions/tasks');
const { refreshApplicationPayments } = require('../src/services/admissions/payments');
const { syncRemindersForApplication } = require('../src/services/admissions/reminders');
const { startAdmissionsReminderJob } = require('../src/jobs/admissionsReminderJob');

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);
const ahead = (days, hour = 11) => {
    const d = new Date(Date.now() + days * DAY);
    d.setHours(hour, 0, 0, 0);
    return d;
};

// Synthetic people only
const STUDENTS = [
    ['Aisha Rahman', 'Kochi', 'MASTER', 'instagram', 0, 2],
    ['Rohan Menon', 'Thrissur', 'BACHELOR', 'referral', 0, 9],
    ['Fathima Nazar', 'Kozhikode', 'MASTER', 'website', 0, 1],
    ['Arjun Pillai', 'Kollam', 'MASTER', 'walk_in', 1, 4],
    ['Sneha Joseph', 'Kottayam', 'BACHELOR', 'instagram', 1, 12],
    ['Vishnu Nair', 'Palakkad', 'MASTER', 'whatsapp', 2, 3],
    ['Meera Krishnan', 'Kannur', 'MASTER', 'referral', 2, 6],
    ['Adil Hussain', 'Malappuram', 'BACHELOR', 'instagram', 2, 15],
    ['Nikhil Varghese', 'Ernakulam', 'MASTER', 'website', 3, 5],
    ['Anjali Thomas', 'Alappuzha', 'MASTER', 'facebook', 3, 2],
    ['Sahil Ahmed', 'Kasaragod', 'BACHELOR', 'referral', 3, 20],
    ['Devika Suresh', 'Pathanamthitta', 'MASTER', 'instagram', 4, 3],
    ['Gautham Raj', 'Idukki', 'MASTER', 'walk_in', 4, 11],
    ['Riya Mathew', 'Wayanad', 'BACHELOR', 'website', 5, 4],
    ['Imran Khan', 'Kochi', 'MASTER', 'instagram', 5, 1],
    ['Lakshmi Prasad', 'Thiruvananthapuram', 'MASTER', 'referral', 6, 8],
    ['Hari Shankar', 'Kollam', 'BACHELOR', 'whatsapp', 6, 2],
    ['Neha George', 'Kottayam', 'MASTER', 'instagram', 7, 5],
    ['Yusuf Ali', 'Kozhikode', 'MASTER', 'referral', 7, 3],
    ['Kavya Menon', 'Thrissur', 'MASTER', 'website', 7, 14],
];

const seed = async () => {
    const business = await Business.create({
        businessName: 'SYB Education (demo)',
        email: 'office@syb.test',
        features: { admissions: true },
    });
    const password = await bcrypt.hash('Password123', 10);
    const mk = (name, email, role, managerId = null) =>
        User.create({ businessId: business._id, name, email, password, role, managerId });

    const owner = await mk('Founder Admin', 'admin@syb.test', 'OWNER');
    business.owner = owner._id;
    await business.save();
    const manager = await mk('Maya Manager', 'manager@syb.test', 'SALES_MANAGER');
    const anu = await mk('Anu Counsellor', 'anu@syb.test', 'SALESPERSON', manager._id);
    const rahul = await mk('Rahul Counsellor', 'rahul@syb.test', 'SALESPERSON', manager._id);
    const divya = await mk('Divya Counsellor', 'divya@syb.test', 'SALESPERSON');
    const counsellors = [anu, rahul, divya];

    // Demo-only platform super admin, to try the /platform console
    const platformAdmin = await PlatformAdmin.create({ name: 'Demo Super Admin', email: 'superadmin@kelto.test', password });

    // Commercial demo data for the Kelto SaaS dashboard.
    const [starterPlan, growthPlan] = await Plan.insertMany([
        {
            key: 'STARTER',
            name: 'Starter',
            description: 'Core CRM for small teams',
            currency: 'USD',
            prices: { monthly: 4900, yearly: 49000 },
            trialDays: 14,
            limits: { users: 5, leads: 2500, students: 0, storageMb: 5120 },
            modules: ['crm'],
            createdBy: platformAdmin._id,
            updatedBy: platformAdmin._id,
        },
        {
            key: 'GROWTH',
            name: 'Growth',
            description: 'CRM and Admissions for growing agencies',
            currency: 'USD',
            prices: { monthly: 14900, yearly: 149000 },
            trialDays: 14,
            limits: { users: 25, leads: 25000, students: 5000, storageMb: 51200 },
            modules: ['crm', 'admissions'],
            createdBy: platformAdmin._id,
            updatedBy: platformAdmin._id,
        },
    ]);
    const periodStart = ago(9);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    await Subscription.create({
        businessId: business._id,
        planId: growthPlan._id,
        planSnapshot: {
            key: growthPlan.key,
            name: growthPlan.name,
            currency: growthPlan.currency,
            prices: growthPlan.prices,
            trialDays: growthPlan.trialDays,
            limits: growthPlan.limits,
            modules: growthPlan.modules,
        },
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        amountMinor: growthPlan.prices.monthly,
        currency: growthPlan.currency,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        updatedBy: platformAdmin._id,
        history: [{ action: 'CREATED', toStatus: 'ACTIVE', toPlanKey: growthPlan.key, reason: 'Demo subscription', by: platformAdmin._id }],
    });

    const config = await ensureConfig(business._id);
    const stages = getActiveStages(config);

    const universities = await University.insertMany([
        {
            businessId: business._id,
            name: 'Charles University',
            city: 'Prague',
            courses: [
                { name: 'MSc Computer Science', level: 'MASTER', language: 'English' },
                { name: 'BSc Economics', level: 'BACHELOR', language: 'English' },
            ],
        },
        {
            businessId: business._id,
            name: 'Czech Technical University in Prague',
            city: 'Prague',
            courses: [
                { name: 'MSc Cybersecurity', level: 'MASTER', language: 'English' },
                { name: 'BSc Software Engineering', level: 'BACHELOR', language: 'English' },
            ],
        },
        {
            businessId: business._id,
            name: 'Masaryk University',
            city: 'Brno',
            courses: [
                { name: 'MSc Data Science', level: 'MASTER', language: 'English' },
                { name: 'BSc Business Management', level: 'BACHELOR', language: 'English' },
            ],
        },
    ]);

    for (const [index, [name, city, level, source, stageIndex, daysInStage]] of STUDENTS.entries()) {
        const counsellor = counsellors[index % counsellors.length];
        const phone = `+91 9${String(800000000 + index * 7919).slice(0, 9)}`;
        const lead = await Lead.create({
            businessId: business._id,
            customerName: name,
            email: `${name.split(' ')[0].toLowerCase()}${index}@student.test`,
            phone,
            whatsapp: phone,
            city,
            source: source === 'walk_in' ? 'WALK_IN' : source.toUpperCase().replace('FACEBOOK', 'OTHER'),
            assignedTo: counsellor._id,
            createdBy: owner._id,
        });

        const university = universities[index % universities.length];
        const course = university.courses.find((c) => c.level === level);
        const createdAt = ago(daysInStage + stageIndex * 12 + 3);

        const application = new AdmissionApplication({
            businessId: business._id,
            studentId: lead._id,
            student: snapshotFromLead(lead),
            counsellorId: counsellor._id,
            createdBy: owner._id,
            studyLevel: level,
            intakeMonth: index % 3 === 0 ? 2 : 9,
            intakeYear: 2027,
            leadSource: source,
            shortlist: stageIndex >= 1 ? [{ universityId: university._id, courseId: course._id, universityName: university.name, courseName: course.name }] : [],
            finalChoice: stageIndex >= 2 ? { universityId: university._id, courseId: course._id, universityName: university.name, courseName: course.name } : {},
            currentStageKey: stages[stageIndex].key,
            stageEnteredAt: ago(daysInStage),
            checklist: buildChecklist(config),
            assessment: stageIndex >= 4
                ? { interviewRequired: index % 2 === 0, examRequired: true, interviewAt: ago(40), examAt: ago(35), interviewResult: 'PASSED', examResult: 'PASSED' }
                : stageIndex === 3
                  ? { interviewRequired: false, examRequired: true, examAt: index === 10 ? ago(2) : ahead(6), examResult: index === 10 ? 'FAILED' : 'PENDING' }
                  : {},
            visa: stageIndex === 7 ? { appointmentAt: ahead(index % 2 ? 3 : 10) } : {},
            stageHistory: stages.slice(0, stageIndex + 1).map((s, i) => ({
                stageKey: s.key,
                stageName: s.name,
                enteredAt: i === stageIndex ? ago(daysInStage) : ago(daysInStage + (stageIndex - i) * 12),
                exitedAt: i === stageIndex ? null : ago(daysInStage + (stageIndex - i - 1) * 12),
                enteredBy: counsellor._id,
                direction: i === 0 ? 'INITIAL' : 'FORWARD',
            })),
        });
        if (index === 10) {
            application.needsReview = true;
            application.reviewReason = 'Entrance exam failed';
        }

        // Complete everything in passed stages, and part of the current one
        for (const stage of stages.slice(0, stageIndex + 1)) {
            const entries = application.checklist.filter((e) => e.stageKey === stage.key && isApplicable(e, application));
            const limit = stage.key === application.currentStageKey ? Math.floor(entries.length / 2) : entries.length;
            for (const entry of entries.slice(0, limit)) {
                if (!checkRule(entry, application)) {
                    setItemStatus(application, entry.itemKey, { status: 'COMPLETED', userId: counsellor._id, now: ago(daysInStage + 1) });
                }
            }
        }

        // Two finished applications: one approved, one rejected
        if (index === 18 || index === 19) {
            application.visa.outcome = index === 18 ? 'APPROVED' : 'REJECTED';
            application.visa.outcomeAt = ago(2);
            application.visa.outcomeBy = counsellor._id;
            application.status = 'CLOSED';
            application.closedAt = ago(2);
            application.stageHistory.at(-1).exitedAt = ago(2);
        }

        application.createdAt = createdAt;
        await application.save();
        await AdmissionApplication.updateOne({ _id: application._id }, { $set: { createdAt } }, { timestamps: false });

        // Follow-ups: some overdue, some today, some upcoming
        if (application.status === 'ACTIVE') {
            const offsets = [[-2], [0], [1], [4], [-1, 3]][index % 5];
            for (const offset of offsets) {
                await FollowUp.create({
                    businessId: business._id,
                    leadId: lead._id,
                    applicationId: application._id,
                    assignedTo: counsellor._id,
                    createdBy: counsellor._id,
                    type: ['CALL', 'WHATSAPP', 'DOCUMENT', 'PAYMENT', 'TASK'][(index + offset + 5) % 5],
                    title: ['Check document status', 'Remind about apostille', 'Confirm fee payment', 'Discuss university shortlist', 'Share visa checklist'][index % 5],
                    priority: offset < 0 ? 'HIGH' : 'MEDIUM',
                    scheduledAt: offset === 0 ? ahead(0, 17) : ahead(offset),
                });
            }
        }

        // Fees from university application onwards
        if (stageIndex >= 3) {
            const agency = new AdmissionFee({
                businessId: business._id,
                applicationId: application._id,
                category: 'SERVICE_FEE',
                amountDueMinor: 15000000,
                currency: 'INR',
                dueDate: index % 4 === 0 ? ago(6) : ahead(15),
                createdBy: owner._id,
            });
            if (index % 3 !== 0) {
                agency.transactions.push({ amountMinor: index % 2 ? 15000000 : 7500000, paidAt: ago(10), reference: `UPI-${1000 + index}`, method: 'UPI', recordedBy: owner._id });
            }
            await agency.save();
        }
        if (stageIndex >= 5) {
            await AdmissionFee.create({
                businessId: business._id,
                applicationId: application._id,
                category: 'STUDENT_EXPENSE',
                amountDueMinor: 300000,
                currency: 'CZK',
                dueDate: ahead(7),
                createdBy: owner._id,
            });
        }
        if (stageIndex >= 6) {
            const uni = new AdmissionFee({
                businessId: business._id,
                applicationId: application._id,
                category: 'UNIVERSITY_FEE',
                amountDueMinor: 500000,
                currency: 'EUR',
                dueDate: ahead(20),
                createdBy: owner._id,
            });
            uni.transactions.push({ amountMinor: 250000, paidAt: ago(3), reference: `SWIFT-${index}`, method: 'Bank transfer', recordedBy: owner._id });
            await uni.save();
        }

        await AdmissionDocument.create({
            businessId: business._id,
            applicationId: application._id,
            documentTypeKey: 'passport',
            status: stageIndex >= 2 ? 'VERIFIED' : 'MISSING',
            reviewedBy: stageIndex >= 2 ? counsellor._id : null,
            reviewedAt: stageIndex >= 2 ? ago(20) : null,
            expiresAt: ahead(400 + index * 30),
            createdBy: counsellor._id,
        });

        await AdmissionActivity.create({
            businessId: business._id,
            applicationId: application._id,
            actorId: counsellor._id,
            type: 'NOTE',
            message: 'Note added',
            body: 'Synthetic demo note: student prefers WhatsApp after 6 pm.',
        });

        await refreshNextFollowUp(application._id);
        await refreshApplicationPayments(application._id);
        await syncRemindersForApplication(application._id);
    }

    await seedSalesDemo(business, owner, counsellors);

    return { owner, manager, counsellors };
};

// Sales leads and quotations for the home dashboard's "Needs attention" and "Quotations" cards
const seedSalesDemo = async (business, owner, [anu, rahul, divya]) => {
    const lead = async (customerName, companyName, status, estimatedValue, assignee, idleDays = 0) => {
        const doc = await Lead.create({ businessId: business._id, customerName, companyName, status, estimatedValue, source: 'REFERRAL', assignedTo: assignee?._id ?? null, createdBy: owner._id });
        // Backdated past Mongoose's timestamps, so the lead reads as untouched
        if (idleDays) await Lead.collection.updateOne({ _id: doc._id }, { $set: { updatedAt: ago(idleDays), createdAt: ago(idleDays + 5) } });
        return doc;
    };
    const globex = await lead('Hannah Lee', 'Globex Training', 'NEGOTIATION', 18000, anu, 12);
    await lead('Marcus Bell', 'Northwind Colleges', 'QUALIFIED', 9500, rahul, 9);
    await lead('Priya Raman', 'Lumen Academy', 'CONTACTED', 4200, divya, 15);
    const initech = await lead('Tom Fischer', 'Initech Learning', 'QUOTATION_SENT', 12500, anu);
    await lead('Walk-in enquiry', '', 'NEW', 1500, null);

    let n = 0;
    const quote = (forLead, status, grandTotal, validInDays, extra = {}) =>
        Quotation.create({
            businessId: business._id,
            leadId: forLead._id,
            quotationNumber: `QT-2026-${String(++n).padStart(3, '0')}`,
            customer: { name: forLead.companyName || forLead.customerName },
            quotationDate: ago(20),
            validUntil: new Date(Date.now() + validInDays * 24 * 60 * 60 * 1000),
            items: [{ itemName: 'Counselling programme', quantity: 1, unitPrice: grandTotal, amount: grandTotal }],
            subtotal: grandTotal,
            grandTotal,
            currency: 'USD',
            status,
            assignedTo: forLead.assignedTo,
            createdBy: owner._id,
            ...extra,
        });
    await quote(initech, 'SENT', 12500, 2, { sentAt: ago(12) });
    await quote(globex, 'SENT', 18000, 5, { sentAt: ago(15) });
    await quote(globex, 'SENT', 6400, 25, { sentAt: ago(3) });
    await quote(initech, 'ACCEPTED', 3200, 10, { sentAt: ago(9), acceptedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    await quote(globex, 'DRAFT', 2500, 30);
};

const main = async () => {
    console.log('[dev:memory] Starting an in-memory MongoDB (first run downloads it)…');
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await runMigrations();
    await seed();

    const port = Number(process.env.PORT) || 5001;
    app.listen(port, () => {
        console.log(`[dev:memory] Demo API on http://localhost:${port} with ${STUDENTS.length} synthetic students.`);
        console.log('[dev:memory] Sign in: admin@syb.test / Password123 (also manager@, anu@, rahul@, divya@ syb.test).');
        console.log('[dev:memory] Super admin console: /platform/login with superadmin@kelto.test / Password123.');
        console.log('[dev:memory] Data disappears when you stop this process.');
    });
    startAdmissionsReminderJob();

    const shutdown = async () => {
        await mongoose.disconnect();
        await mongod.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
};

main().catch((error) => {
    console.error('[dev:memory] Failed:', error);
    process.exit(1);
});
