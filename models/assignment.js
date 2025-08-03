// Check your models/assignment.js
const assignmentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dueDate: { type: Date },
  maxMarks: { type: Number, default: 100 },
  attachments: [{
    filename: String,
    path: String,
    size: Number,
    mimetype: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  instructions: { type: String, default: '' },
  allowLateSubmission: { type: Boolean, default: false },
  category: { 
    type: String, 
    enum: ['assignment', 'quiz', 'project', 'exam', 'homework'],
    default: 'assignment'
  },
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'draft'],
    default: 'active'
  },
  submissions: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: String,
    attachments: [String],
    submittedAt: { type: Date, default: Date.now },
    isLate: { type: Boolean, default: false },
    marks: Number,
    feedback: String,
    gradedAt: Date,
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['submitted', 'graded'], default: 'submitted' }
  }]
}, {
  timestamps: true
});