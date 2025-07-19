const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  content: {
    type: String,
    required: true
  },
  attachments: [{
    filename: String,
    url: String,
    size: Number
  }],
  grade: {
    type: Number,
    min: 0,
    default: null
  },
  feedback: {
    type: String,
    default: ''
  },
  gradedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  gradedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

const assignmentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  instructions: {
    type: String,
    default: '',
    maxlength: 1000
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  dueDate: {
    type: Date,
    default: null
  },
  maxMarks: {
    type: Number,
    default: 100,
    min: 1,
    max: 1000
  },
  category: {
    type: String,
    enum: ['assignment', 'quiz', 'project', 'exam'],
    default: 'assignment'
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'closed'],
    default: 'active'
  },
  allowLateSubmission: {
    type: Boolean,
    default: false
  },
  attachments: [{
    filename: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      default: 0
    }
  }],
  submissions: [submissionSchema],
  settings: {
    allowMultipleSubmissions: {
      type: Boolean,
      default: false
    },
    showGradesToStudents: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtuals
assignmentSchema.virtual('isOverdue').get(function () {
  return this.dueDate && new Date() > this.dueDate;
});

assignmentSchema.virtual('timeRemaining').get(function () {
  if (!this.dueDate) return null;
  const now = new Date();
  const diff = new Date(this.dueDate) - now;
  if (diff <= 0) return 'Overdue';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days} days ${hours} hours`;
  if (hours > 0) return `${hours} hours ${minutes} minutes`;
  return `${minutes} minutes`;
});

assignmentSchema.virtual('submissionCount').get(function () {
  return this.submissions?.length || 0;
});

// Methods
assignmentSchema.methods.canSubmit = function (userId) {
  if (this.status !== 'active') return false;
  if (this.dueDate && new Date() > this.dueDate && !this.allowLateSubmission) return false;
  if (!this.settings.allowMultipleSubmissions) {
    return !this.submissions.some(sub => sub.studentId.toString() === userId.toString());
  }
  return true;
};

assignmentSchema.methods.getUserSubmission = function (userId) {
  return this.submissions.find(sub => sub.studentId.toString() === userId.toString());
};

// Indexes
assignmentSchema.index({ classId: 1, createdAt: -1 });
assignmentSchema.index({ createdBy: 1 });
assignmentSchema.index({ status: 1 });
assignmentSchema.index({ dueDate: 1 });
assignmentSchema.index({ 'submissions.studentId': 1 });

module.exports = mongoose.model('Assignment', assignmentSchema);
