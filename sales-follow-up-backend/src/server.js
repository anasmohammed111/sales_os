const express = require('express');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const leadRoutes = require('./routes/leadRoutes');
const followUpRoutes = require('./routes/followUpRoutes');
const teamRoutes = require('./routes/teamRoutes');
const pipelineRoutes = require('./routes/pipelineRoutes');
const quotationRoutes = require('./routes/quotationRoutes');
const { startQuotationExpiryJob } = require('./jobs/quotationExpiryJob');

const app = express();

app.disable('x-powered-by');

const allowedOrigins = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map((url) => url.trim())
    : ['http://localhost:4200'];

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
    })
);

app.use(express.json({ limit: '50kb' }));

app.get('/', (req, res) => {
    res.send('Sales Follow-up API is running');
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Sales Follow-up API is running',
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/follow-ups', followUpRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/quotation', quotationRoutes);

// Catch-all for undefined API routes
app.use('/api', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'API endpoint not found',
    });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            success: false,
            message: 'Malformed JSON payload provided',
        });
    }

    if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({
            success: false,
            message: 'CORS request blocked',
        });
    }

    console.error('Unhandled server error:', err);
    return res.status(500).json({
        success: false,
        message: 'Internal server error',
    });
});

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