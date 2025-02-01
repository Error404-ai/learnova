const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendemail');
const validator = require('validator');
const bcrypt = require('bcrypt');
const OTP = require('../models/otp');
const User = require('../models/User'); 

// Signup API
exports.signup = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required' });
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      isVerified: false
    });

    await newUser.save();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await OTP.findOneAndUpdate(
      { email },
      { otp, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
      { upsert: true }
    );
    //sendotp
    await sendEmail(email, `Your OTP: ${otp}`, 'Email Verification');

    res.status(200).json({ message: 'User created. Please verify your email with the OTP sent.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user', error: error.message });
  }
};

//verify otp
exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }

  try {
    const otpRecord = await OTP.findOne({ email });
    if (!otpRecord || otpRecord.otp !== otp) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const user = await User.findOneAndUpdate(
      { email },
      { isVerified: true },
      { new: true }
    );

    console.log('Email from OTP verification:', user.email);

    const verificationToken = jwt.sign(
      { email: user.email }, 
      process.env.JWT_SECRET, 
      { expiresIn: '1h' } // You can adjust expiration if needed
    );

    await OTP.deleteOne({ email });

    res.status(200).json({ message: 'OTP verified successfully', token: verificationToken });
  } catch (error) {
    res.status(500).json({ message: 'Error verifying OTP', error: error.message });
  }
};

// "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NzlkYmIzMmFlM2FjZWY1NjRlNWNlODQiLCJpYXQiOjE3MzgzOTAzNzcsImV4cCI6MTczODM5Mzk3N30.LC-ia4wTddnFVk0eidUlW5k8zu2JV4QBebvPy8CWmOM"
//login api
exports.login = async (req, res) => {
  const { email, password, token: verifToken } = req.body;

  if (!email || !password || !verifToken) {
    return res.status(400).json({ message: 'Email, password and verification token are required' });
  }

  try {
    const decoded = jwt.verify(verifToken, process.env.JWT_SECRET);

    const tokenEmail = decoded.email ? decoded.email.trim().toLowerCase() : '';
    const requestEmail = email.trim().toLowerCase();

    console.log('Email from token:', tokenEmail);
    console.log('Email from request:', requestEmail);

    if (!tokenEmail || tokenEmail !== requestEmail) {
      return res.status(400).json({ message: 'Verification token does not match email' });
    }

    const user = await User.findOne({ email: requestEmail });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (!user.isVerified) {
      return res.status(401).json({ message: 'Email not verified. Please verify your email first.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    const sessionToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ message: 'Login successful', token: sessionToken });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


//forgot password api
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email || !validator.isEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await OTP.findOneAndUpdate(
      { email },
      { otp, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
      { upsert: true }
    );

    await sendEmail(email, `Your OTP for password reset: ${otp}`, 'Password Reset OTP');

    res.status(200).json({ message: 'OTP sent to your email. Please verify to reset password.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to send OTP', error: error.message });
  }
};

//reset Password api
exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: 'Email, OTP, and new password are required' });
  }

  try {
    const otpRecord = await OTP.findOne({ email });
    if (!otpRecord || otpRecord.otp !== otp) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findOneAndUpdate({ email }, { password: hashedPassword });

    await OTP.deleteOne({ email });

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error resetting password', error: error.message });
  }
};