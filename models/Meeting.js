const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  scheduledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  duration: {
    type: Number, // Duration in minutes
    required: true,
    min: 15,
    max: 480 // Max 8 hours
  },
  meetingType: {
    type: String,
    enum: ['google-meet', 'zoom', 'teams', 'manual-link'],
    required: true
  },
  meetingLink: {
    type: String,
    required: true
  },
  meetingId: {
    type: String, // For Google Meet or Zoom meeting ID
    required: false
  },
  password: {
    type: String, // For Zoom meetings
    required: false
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  attendees: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: Date,
    leftAt: Date,
    duration: Number // Duration in minutes
  }],
  recurring: {
    enabled: {
      type: Boolean,
      default: false
    },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      required: false
    },
    endDate: {
      type: Date,
      required: false
    }
  },
  reminders: [{
    type: {
      type: String,
      enum: ['email', 'notification', 'sms'],
      required: true
    },
    time: {
      type: Number, // Minutes before meeting
      required: true
    },
    sent: {
      type: Boolean,
      default: false
    }
  }],
  isPrivate: {
    type: Boolean,
    default: false
  },
  maxParticipants: {
    type: Number,
    default: 100
  },
  recordingEnabled: {
    type: Boolean,
    default: false
  },
  recordingUrl: {
    type: String,
    required: false
  },
  agenda: [{
    title: String,
    duration: Number, // Duration in minutes
    description: String
  }],
  materials: [{
    name: String,
    url: String,
    type: String // 'document', 'presentation', 'video', etc.
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

meetingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

meetingSchema.index({ classId: 1, scheduledDate: 1 });
meetingSchema.index({ scheduledBy: 1 });
meetingSchema.index({ status: 1 });

module.exports = mongoose.model('Meeting', meetingSchema);