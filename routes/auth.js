const express = require('express');
const { signup, verifyOTP, login, forgotPassword , resetPassword, refreshToken , resendOTP  } = require('../controllers/authcontrollers');
const { authenticateUser} = require('../middlewares/authMiddleware');
const router = express.Router();

router.post('/signup', signup);               
router.post('/verify-otp', verifyOTP);         
router.post('/login', login);                
router.post('/forgot-password', forgotPassword); 
router.put('/reset-password', authenticateUser, resetPassword);
router.post('/refresh', refreshToken);
router.post('/resendOtp', resendOTP);

module.exports = router;
