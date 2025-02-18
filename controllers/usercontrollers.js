const User = require("../models/User");

exports.updateProfiles = async (req, res) => {
    try {
        console.log("Received body data:", req.body);
        console.log("Request user object:", req.user);

        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { leetcode, codeforces, codechef, hackerrank } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        console.log("User found in DB:", user);

        user.platforms = user.platforms || { leetcode: "", codeforces: "", codechef: "", hackerrank: "" };

        if (leetcode !== undefined) user.platforms.leetcode = leetcode;
        if (codeforces !== undefined) user.platforms.codeforces = codeforces;
        if (codechef !== undefined) user.platforms.codechef = codechef;
        if (hackerrank !== undefined) user.platforms.hackerrank = hackerrank;

        user.markModified("platforms");

        await user.save();

        console.log("Updated user object before saving:", user);

        res.json({ message: "Profiles updated successfully", platforms: user.platforms });
    } catch (error) {
        console.error("Error in updateProfiles:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};
