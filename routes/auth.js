const express = require('express');
const { sendOTP, verifyOTP, signup } = require('../controllers/authcontrollers');

const router = express.Router();

router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/signup', signup);

module.exports = router;
