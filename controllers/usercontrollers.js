const User = require("../models/User");

exports.updateProfiles = async (req, res) => {
  try {
    const { userId, leetcode, codeforces, codechef , hackerrank } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: "User not found" });

    // Update platform handles
    user.platforms = user.platforms || {};
    user.platforms.leetcode = leetcode || user.platforms.leetcode;
    user.platforms.codeforces = codeforces || user.platforms.codeforces;
    user.platforms.codechef = codechef || user.platforms.codechef;
    user.platforms.hackerrank = hackerrank || user.platforms.hackerrank;

    await user.save();
    res.json({ message: "Profiles updated successfully", platforms: user.platforms });
  } catch (error) {
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};
