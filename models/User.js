const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true },
  isVerified: { type: Boolean, default: false },
  password: { type: String, required: true },
  refreshToken: { type: String, default: "" },

  platforms: {
    leetcode: { type: String, default: "" },
    codeforces: { type: String, default: "" },
    codechef: { type: String, default: "" },
   hackerrank: { type: String, default: "" }
  },


  stats: {
    totalQuestions: { type: Number, default: 0 },
    activeDays: { type: Number, default: 0 },
    maxStreak: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 }
  },

  submissions: [
    {
      date: { type: Date, default: Date.now },
      platform: String,
      difficulty: String
    }
  ],

  badges: [String]
});

module.exports = mongoose.model("User", userSchema);
