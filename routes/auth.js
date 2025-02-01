const express = require('express');
const { signup, verifyOTP, login, forgotPassword , resetPassword } = require('../controllers/authcontrollers');

const router = express.Router();

router.post('/signup', signup);               
router.post('/verify-otp', verifyOTP);         
router.post('/login', login);                
router.post('/forgot-password', forgotPassword); 
router.post('/reset-password', resetPassword);

module.exports = router;
