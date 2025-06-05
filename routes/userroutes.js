const express = require("express");
const { 
    updateProfile, 
    updatePreferences, 
    getProfile, 
    joinClassroom, 
    leaveClassroom, 
    getNotifications, 
    markNotificationRead,
    getDashboard
} = require("../controllers/usercontrollers");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

router.get("/profile", protect, getProfile);
router.put("/profile", protect, updateProfile);

router.put("/preferences", protect, updatePreferences);

router.post("/join-classroom", protect, joinClassroom);
router.post("/leave-classroom", protect, leaveClassroom);

router.get("/notifications", protect, getNotifications);
router.put("/notifications/read", protect, markNotificationRead);


router.get("/dashboard", protect, getDashboard);

module.exports = router;