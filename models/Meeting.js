const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
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
    max: 480 // 8 hours max
  },
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'completed', 'cancelled'], // ✅ FIXED: Updated to match controller
    default: 'scheduled'
  },
  // Basic meeting settings
  isPrivate: {
    type: Boolean,
    default: false
  },
  maxParticipants: {
    type: Number,
    default: 50,
    min: 2,
    max: 100
  },
  chatEnabled: {
    type: Boolean,
    default: true
  },
  screenShareEnabled: {
    type: Boolean,
    default: true
  },
  // Attendee tracking
  attendees: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    joinedAt: {
      type: Date,
      required: true
    },
    leftAt: {
      type: Date
    },
    duration: {
      type: Number // Duration in minutes
    }
  }],
  // Meeting timing
  startedAt: Date,
  endedAt: Date,
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actualDuration: {
    type: Number // Actual duration in minutes
  },
  cancelledAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for better query performance
meetingSchema.index({ classId: 1, scheduledDate: 1 });
meetingSchema.index({ status: 1, scheduledDate: 1 });
meetingSchema.index({ scheduledBy: 1 });

// ✅ FIXED: Use 'active' instead of 'live' to match controller
meetingSchema.virtual('isActive').get(function() {
  return this.status === 'active';
});

// Virtual for getting active participants count
meetingSchema.virtual('activeParticipantsCount').get(function() {
  return this.attendees.filter(attendee => !attendee.leftAt).length;
});

// Pre-save middleware to validate scheduled date
meetingSchema.pre('save', function(next) {
  if (this.isNew && this.scheduledDate <= new Date()) {
    next(new Error('Meeting must be scheduled for a future date'));
  }
  next();
});

module.exports = mongoose.model('Meeting', meetingSchema);