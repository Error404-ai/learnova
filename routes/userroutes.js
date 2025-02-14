const express = require("express");
const { updateProfiles } = require("../controllers/usercontrollers");

const router = express.Router();

router.post("/update-profiles", updateProfiles);

module.exports = router;
