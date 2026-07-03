const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    }
}, {
    timestamps: true
});

const communityPostSchema = new mongoose.Schema({
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    content: {
        type: String,
        required: true,
        trim: true,
        maxlength: 5000
    },
    category: {
        type: String,
        enum: ['Discussion', 'Doubt', 'Resource', 'Announcement', 'Project', 'Achievement'],
        default: 'Discussion'
    },
    attachments: [{
        filename: { type: String },
        path: { type: String },
        url: { type: String },
        size: { type: Number },
        mimetype: { type: String },
        uploadedAt: { type: Date, default: Date.now }
    }],
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    comments: [commentSchema],
    isPinned: {
        type: Boolean,
        default: false
    },
    isEdited: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

communityPostSchema.index({ category: 1 });
communityPostSchema.index({ isPinned: -1, createdAt: -1 });
communityPostSchema.index({ author: 1 });

module.exports = mongoose.model('CommunityPost', communityPostSchema);
