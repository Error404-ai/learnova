exports.updateProfiles = async (req, res) => {
    try {
      console.log("Extracted userId from token:", req.user?.id); 
  
      const userId = req.user?.id; 
      if (!userId) {
        return res.status(400).json({ error: "User ID not found in token" });
      }
  
      const { leetcode, codeforces, codechef, hackerrank } = req.body;
      const user = await User.findById(userId);
      console.log("User Found in DB:", user); 
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
  
 
      user.platforms = user.platforms || {};
      user.platforms.leetcode = leetcode || user.platforms.leetcode;
      user.platforms.codeforces = codeforces || user.platforms.codeforces;
      user.platforms.codechef = codechef || user.platforms.codechef;
      user.platforms.hackerrank = hackerrank || user.platforms.hackerrank;
  
      await user.save();
      res.json({ message: "Profiles updated successfully", platforms: user.platforms });
    } catch (error) {
      console.error("Error in updateProfiles:", error.message);
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  };
  