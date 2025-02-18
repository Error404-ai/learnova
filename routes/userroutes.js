const express = require("express");
const { updateProfiles } = require("../controllers/usercontrollers");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

router.put("/update-profiles", protect, updateProfiles);

module.exports = router;
