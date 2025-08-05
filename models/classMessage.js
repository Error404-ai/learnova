const mongoose = require('mongoose');

const classMessageSchema = new mongoose.Schema({
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  userRole: {
    type: String,
    enum: ['teacher', 'student'],
    required: true
  },
  message: {
    type: String,
    required: true,
    maxlength: 1000
  },
  type: {
    type: String,
    enum: ['message', 'announcement', 'question'],
    default: 'message'
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  urgent: {
    type: Boolean,
    default: false
  },
  readBy: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  editedAt: Date,
  deletedAt: Date
}, {
  timestamps: true
});

classMessageSchema.index({ classId: 1, createdAt: -1 });
classMessageSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ClassMessage', classMessageSchema);
