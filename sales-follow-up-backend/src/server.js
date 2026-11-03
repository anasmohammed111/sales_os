require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/db');
const { startQuotationExpiryJob } = require('./jobs/quotationExpiryJob');
const { runMigrations } = require('./migrations');
const { startAdmissionsReminderJob } = require('./jobs/admissionsReminderJob');

const PORT = process.env.PORT || 5001;

const startServer = async () => {
    await connectDB();
    await runMigrations();
    startQuotationExpiryJob();
    startAdmissionsReminderJob();

    app.listen(PORT, () => {
        console.log(
            `Server running on http://localhost:${PORT}`
        );
    });
};

startServer();
