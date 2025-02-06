const express = require('express');
const { signup, verifyOTP, login, forgotPassword , resetPassword, refreshToken ,verifyOtp,  resendOTP  } = require('../controllers/authcontrollers');
const router = express.Router();

router.post('/signup', signup);               
router.post('/verify-otp', verifyOTP);         
router.post('/login', login);                
router.post('/forgot-password', forgotPassword);
router.post('/otp-verify', verifyOtp) 
router.put('/reset-password', resetPassword);
router.post('/refresh', refreshToken);
router.post('/resendOtp', resendOTP);

module.exports = router;
