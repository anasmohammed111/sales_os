// Shared test utilities: in-memory MongoDB, factories and auth headers.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.STORAGE_DRIVER = 'local';

const os = require('os');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.STORAGE_LOCAL_DIR =
    process.env.STORAGE_LOCAL_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-storage-'));

const Business = require('../src/models/Business');
const User = require('../src/models/User');
const { generateToken } = require('../src/services/authService');

let mongod = null;
let counter = 0;

const startDb = async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
};

const stopDb = async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
};

const resetDb = async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
};

const makeBusiness = async ({ admissions = true, name } = {}) => {
    counter += 1;
    const business = await Business.create({
        businessName: name || `Business ${counter}`,
        email: `business${counter}@example.com`,
        features: { admissions },
    });
    return business;
};

const PASSWORD = 'Password123';
let passwordHash = null;

const makeUser = async (business, { role = 'SALESPERSON', managerId = null, name, isActive = true } = {}) => {
    counter += 1;
    passwordHash = passwordHash || (await bcrypt.hash(PASSWORD, 4));
    const user = await User.create({
        businessId: business._id,
        name: name || `${role} ${counter}`,
        email: `user${counter}@example.com`,
        password: passwordHash,
        role,
        managerId,
        isActive,
    });
    if (role === 'OWNER' && !business.owner) {
        business.owner = user._id;
        await business.save();
    }
    return user;
};

const auth = (user) => ({ Authorization: `Bearer ${generateToken(user)}` });

module.exports = {
    PASSWORD,
    startDb,
    stopDb,
    resetDb,
    makeBusiness,
    makeUser,
    auth,
};

// A business with the admissions module and a typical team:
// counsellorA reports to the manager; counsellorB has no manager.
const makeAdmissionsTeam = async () => {
    const business = await makeBusiness();
    const owner = await makeUser(business, { role: 'OWNER', name: 'Owner' });
    const manager = await makeUser(business, { role: 'SALES_MANAGER', name: 'Manager' });
    const counsellorA = await makeUser(business, { role: 'SALESPERSON', managerId: manager._id, name: 'Counsellor A' });
    const counsellorB = await makeUser(business, { role: 'SALESPERSON', name: 'Counsellor B' });
    return { business, owner, manager, counsellorA, counsellorB };
};

const studentPayload = ({ student = {}, ...rest } = {}) => ({
    student: {
        name: 'Asha Nair',
        email: 'asha@example.com',
        phone: '+91 98765 43210',
        whatsapp: '+91 98765 43210',
        city: 'Kochi',
        ...student,
    },
    studyLevel: 'MASTER',
    intakeMonth: 9,
    intakeYear: 2027,
    leadSource: 'instagram',
    ...rest,
});

module.exports.makeAdmissionsTeam = makeAdmissionsTeam;
module.exports.studentPayload = studentPayload;
