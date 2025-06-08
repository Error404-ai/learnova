const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
  className: { type: String, required: true },
  subject: { type: String, required: true },
  privacy: { type: String, enum: ['public', 'private'], default: 'private' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  coordinators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  favourites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

module.exports = mongoose.model('Class', classSchema);
