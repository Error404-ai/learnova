const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true,  trim: true },
  email: { type: String, required: true, unique: true },
  isVerified: { type: Boolean, default: false },
  password: { type: String, required: true },
  refreshToken: { type: String, default: '' }
});

module.exports = mongoose.model('User', userSchema);
