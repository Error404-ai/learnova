const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  // Basic user information
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true },
  isVerified: { type: Boolean, default: false },
  password: { type: String, required: true },
  refreshToken: { type: String, default: "" },

 role: { 
  type: String, 
  enum: ['student', 'teacher', 'admin'] 
},
  
  profilePicture: { type: String, default: "" },
  bio: { type: String, default: "", maxlength: 500 },
  phone: { type: String, default: "" },
  
  // Academic information
  grade: { type: String, default: "" }, // For students
  subject: { type: String, default: "" }, // For teachers
  school: { type: String, default: "" },
  studentId: { type: String, default: "" }, // For students
  teacherId: { type: String, default: "" }, // For teachers

  // Classroom relationships
  classrooms: [{
    classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' },
    role: { type: String, enum: ['student', 'teacher'], required: true },
    joinedAt: { type: Date, default: Date.now }
  }],

  // Academic progress (for students)
  academicStats: {
    totalAssignments: { type: Number, default: 0 },
    completedAssignments: { type: Number, default: 0 },
    averageGrade: { type: Number, default: 0 },
    totalQuizzes: { type: Number, default: 0 },
    completedQuizzes: { type: Number, default: 0 }
  },

  // Assignments and submissions
  assignments: [{
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' },
    submittedAt: { type: Date },
    grade: { type: Number },
    feedback: { type: String },
    status: { 
      type: String, 
      enum: ['pending', 'submitted', 'graded', 'late'], 
      default: 'pending' 
    }
  }],

  // Notifications and settings
  notifications: [{
    message: { type: String, required: true },
    type: { 
      type: String, 
      enum: ['assignment', 'grade', 'announcement', 'reminder', 'general'],
      default: 'general'
    },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    relatedId: { type: mongoose.Schema.Types.ObjectId } // Reference to assignment, classroom, etc.
  }],

  // User preferences
  preferences: {
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
    language: { type: String, default: 'en' }
  },

  // Activity tracking
  lastLogin: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  
  // Google OAuth fields
  googleId: { type: String, default: "" },
  
}, {
  timestamps: true // Adds createdAt and updatedAt automatically
});


userSchema.index({ role: 1 });
userSchema.index({ 'classrooms.classroomId': 1 });

module.exports = mongoose.model("User", userSchema);