require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/db');
const { startQuotationExpiryJob } = require('./jobs/quotationExpiryJob');

const PORT = process.env.PORT || 5001;

const startServer = async () => {
    await connectDB();
    startQuotationExpiryJob();

    app.listen(PORT, () => {
        console.log(
            `Server running on http://localhost:${PORT}`
        );
    });
};

startServer();
