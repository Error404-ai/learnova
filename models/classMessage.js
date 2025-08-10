const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true
    },
    senderName: {
        type: String,
        required: false
    },
    senderRole: {
        type: String,
        enum: ['teacher', 'student'],
        required: false
    },
    content: {
        type: String,
        required: true
    },
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class', 
        required: true 
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    type: {
        type: String,
        enum: ['message', 'announcement'],
        default: 'message'
    },
 
});

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;