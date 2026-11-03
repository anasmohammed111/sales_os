const mongoose = require('mongoose');

// Records which startup migrations have been applied.
const migrationSchema = new mongoose.Schema({
    _id: { type: String },
    appliedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Migration', migrationSchema);
