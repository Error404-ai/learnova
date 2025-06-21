const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
    className: {
        type: String,
        required: true,
        trim: true
    },
    subject: {
        type: String,
        required: true,
        trim: true
    },
    privacy: {
        type: String,
        enum: ['public', 'private'],
        default: 'private'
    },
    classCode: {
        type: String,
        unique: true,
        required: true,
        uppercase: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    students: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    coordinators: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    favourites: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    description: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});


classSchema.pre('save', async function(next) {
    if (this.isNew && !this.classCode) {
        let classCode;
        let isUnique = false;
        
        while (!isUnique) {
            // Generate 6-character alphanumeric code
            classCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            
            // Check if code already exists
            const existingClass = await this.constructor.findOne({ classCode });
            if (!existingClass) {
                isUnique = true;
            }
        }
        
        this.classCode = classCode;
    }
    next();
});

module.exports = mongoose.model('Class', classSchema);