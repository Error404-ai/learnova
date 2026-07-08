const mongoose = require('mongoose');

const todoSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  },
  done: {
    type: Boolean,
    default: false
  },
  // Optional link to a class - lets the frontend show "Math HW" tagged to a
  // class, or filter the todo list per-class. Null/omitted = personal-only todo.
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    default: null
  },
  dueDate: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

todoSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Todo', todoSchema);