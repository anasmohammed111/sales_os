const mongoose = require('mongoose');

const universitySchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
        name: { type: String, required: true, trim: true, maxlength: 150 },
        city: { type: String, trim: true, default: '', maxlength: 100 },
        website: { type: String, trim: true, default: '', maxlength: 300 },
        courses: [
            {
                name: { type: String, required: true, trim: true, maxlength: 150 },
                level: { type: String, enum: ['BACHELOR', 'MASTER'], required: true },
                language: { type: String, trim: true, default: '', maxlength: 50 },
                isArchived: { type: Boolean, default: false },
            },
        ],
        isArchived: { type: Boolean, default: false },
    },
    { timestamps: true }
);

universitySchema.index({ businessId: 1, name: 1 });

module.exports = mongoose.model('University', universitySchema);
