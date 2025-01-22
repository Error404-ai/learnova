const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendemail');
const validator = require('validator'); // Add email validation library

exports.sendOTP = async (req, res) => {
  const { email } = req.body;

  // Validate email
  if (!email || !validator.isEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  // Generate OTP
  const otp = Math.floor(100000 + Math.random() * 900000);

  // Sign OTP with JWT
  const token = jwt.sign({ email, otp }, process.env.JWT_SECRET, { expiresIn: '10m' });

  // Send OTP via email
  try {
    await sendEmail(email, `Your OTP: ${otp}`, 'OTP Verification');
    res.status(200).json({ token, message: 'OTP sent successfully' });
  } catch (error) {
    console.error("Email sending error:", error); // Log error for debugging
    res.status(500).json({ message: 'Failed to send OTP email', error: error.message });
  }
};

exports.verifyOTP = (req, res) => {
  const { token, otp } = req.body;

  if (!token || !otp) {
    return res.status(400).json({ message: 'Token and OTP are required' });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if OTP matches
    if (decoded.otp === otp) {
      res.status(200).json({ message: 'OTP verified successfully' });
    } else {
      res.status(400).json({ message: 'Invalid OTP' });
    }
  } catch (error) {
    // Handle expiry error specifically
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token has expired, please request a new OTP' });
    }
    // Handle other errors
    res.status(401).json({ message: 'Invalid or expired token', error: error.message });
  }
};
