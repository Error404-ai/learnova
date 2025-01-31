const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendemail');
const validator = require('validator');
const bcrypt = require('bcrypt');
const User = require('../models/User');  // Ensure User model is imported

//sendotp api
exports.sendOTP = async (req, res) => {
  const { email } = req.body;

  if (!email || !validator.isEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }
  const otp = Math.floor(100000 + Math.random() * 900000);
  const token = jwt.sign({ email, otp }, process.env.JWT_SECRET, { expiresIn: '30m' });

  try {
    await sendEmail(email, `Your OTP: ${otp}`, 'OTP Verification');
    res.status(200).json({ token, message: 'OTP sent successfully' });
  } catch (error) {
    console.error("Email sending error:", error);
    res.status(500).json({ message: 'Failed to send OTP email', error: error.message });
  }
};

//verifyotp api
exports.verifyOTP = (req, res) => {
  const { token, otp } = req.body;

  if (!token || !otp) {
    return res.status(400).json({ message: 'Token and OTP are required' });
  }

  try {

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log("Received OTP:", otp);
    console.log("Decoded OTP:", decoded.otp);

    if (String(decoded.otp) === String(otp)) {
      res.status(200).json({ message: 'OTP verified successfully' });
    } else {
      res.status(400).json({ message: 'Invalid OTP' });
    }
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token has expired, please request a new OTP' });
    }
    res.status(401).json({ message: 'Invalid or expired token', error: error.message });
  }
};

// Signup API
exports.signup = async (req, res) => {
  const { name, email, password, token } = req.body;

  if (!email || !validator.isEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'Password should be at least 6 characters long' });
  }

  if (!token) {
    return res.status(400).json({ message: 'Token is required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Received OTP:", otp);
    console.log("Decoded OTP:", decoded.otp);

    if (String(decoded.otp) !== String(otp)) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      isVerified : true,
    });

    await newUser.save();

    const userToken = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({ message: 'User registered successfully', token: userToken });

  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ message: 'Failed to register user', error: error.message });
  }
};
