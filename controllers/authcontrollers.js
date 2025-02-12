const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendemail');
const validator = require('validator');
const bcrypt = require('bcrypt');
const OTP = require('../models/otp');
const User = require('../models/User'); 

// Generate Access & Refresh Tokens
const generateTokens = (userId, email) => {
    const accessToken = jwt.sign(
        { userId, email },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
        { userId },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
    );
    
    return { accessToken, refreshToken };
};

// Store Refresh Token
const storeRefreshToken = async (userId, refreshToken) => {
    await User.findByIdAndUpdate(userId, { refreshToken });
};

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
            return res.status(400).json({ message: 'User already exists. Please login or verify OTP.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashedPassword, isVerified: false });
        await newUser.save();

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await OTP.findOneAndUpdate({ email }, { otp, expiresAt: new Date(Date.now() + 30 * 60 * 1000) }, { upsert: true });

        await sendEmail(email, `Your OTP: ${otp}`, 'Email Verification');
        res.status(200).json({ message: 'User created. Please verify your email with OTP.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create user', error: error.message });
    }
};

// Resend OTP API
exports.resendOTP = async (req, res) => {
    const { email } = req.body;

    if (!email || !validator.isEmail(email)) {
        return res.status(400).json({ message: 'Valid email is required' });
    }

    try {
        const existingUser = await User.findOne({ email });
        if (!existingUser) {
            return res.status(400).json({ message: 'User not found' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await OTP.findOneAndUpdate({ email }, { otp, expiresAt: new Date(Date.now() + 30 * 60 * 1000) }, { upsert: true });

        await sendEmail(email, `Your OTP: ${otp}`, 'Email Verification');
        res.status(200).json({ message: 'OTP resent successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error resending OTP', error: error.message });
    }
};

// Verify OTP API 
exports.verifyOTP = async (req, res) => {
    const { otp } = req.body;

    if (!otp) {
        return res.status(400).json({ message: 'OTP is required' });
    }

    try {
        const otpRecord = await OTP.findOne({ otp });

        if (!otpRecord) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        const user = await User.findOneAndUpdate({ email: otpRecord.email }, { isVerified: true }, { new: true });

        const { accessToken, refreshToken } = generateTokens(user._id, user.email);
        await storeRefreshToken(user._id, refreshToken);

        await OTP.deleteOne({ otp });  
        res.status(200).json({ message: 'OTP verified successfully', accessToken, refreshToken });
    } catch (error) {
        res.status(500).json({ message: 'Error verifying OTP', error: error.message });
    }
};


// Forgot Password API 
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;

    if (!email || !validator.isEmail(email)) {
        return res.status(400).json({ message: 'Valid email is required' });
    }

    try {
        const existingUser = await User.findOne({ email });
        if (!existingUser) {
            return res.status(400).json({ message: 'User not found' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await OTP.findOneAndUpdate({ email }, { otp, expiresAt: new Date(Date.now() + 30 * 60 * 1000) }, { upsert: true });

        await sendEmail(email, `Your OTP for password reset: ${otp}`, 'Password Reset OTP');
        res.status(200).json({ message: 'Password reset OTP sent successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error sending password reset OTP', error: error.message });
    }
};

//otp verification
exports.verifyOtp = async (req, res) => {
    const { otp } = req.body;

    if (!otp) {
        return res.status(400).json({ message: 'OTP is required' });
    }
    try {
        const otpRecord = await OTP.findOne({ otp });
        if (!otpRecord) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }
        const resetToken = jwt.sign({ email: otpRecord.email }, process.env.RESET_PASSWORD_SECRET, { expiresIn: '10m' });

        await OTP.deleteOne({ otp });

        res.status(200).json({ message: 'OTP verified successfully', resetToken });

    } catch (error) {
        res.status(500).json({ message: 'Error verifying OTP', error: error.message });
    }
};

//Reset Password Api
exports.resetPassword = async (req, res) => {
    try {
        const { newPassword } = req.body;
        const resetToken = req.headers['authorization']?.split(' ')[1];

        if (!newPassword) {
            return res.status(400).json({ message: 'New password is required' });
        }

        if (!resetToken) {
            return res.status(401).json({ message: 'Reset token is missing' });
        }

        let decoded;
        try {
            decoded = jwt.verify(resetToken, process.env.RESET_PASSWORD_SECRET);
        } catch (error) {
            return res.status(401).json({ message: 'Invalid or expired reset token' });
        }

        const user = await User.findOne({ email: decoded.email });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await User.findOneAndUpdate({ email: decoded.email }, { password: hashedPassword });

        res.status(200).json({ message: 'Password reset successfully' });

    } catch (error) {
        res.status(500).json({ message: 'Error resetting password', error: error.message });
    }
};


// Login API 
exports.login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }

    try {
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        if (!user.isVerified) {
            return res.status(401).json({ message: 'Email not verified. Please verify first.' });
        }

        const { accessToken, refreshToken } = generateTokens(user._id, user.email);
        await storeRefreshToken(user._id, refreshToken);

        res.status(200).json({ message: 'Login successful', accessToken, refreshToken });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Refresh Token API
exports.refreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ message: 'Refresh token is required' });
    }

    try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user || user.refreshToken !== refreshToken) {
            return res.status(403).json({ message: 'Invalid refresh token' });
        }

        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id, user.email);
        await storeRefreshToken(user._id, newRefreshToken);

        res.status(200).json({ accessToken, refreshToken: newRefreshToken });
    } catch (error) {
        res.status(403).json({ message: 'Invalid refresh token', error: error.message });
    }
};

const passport = require("passport");

// Google Login Route
exports.googleAuth = passport.authenticate("google", { scope: ["profile", "email"] });

// Google Callback Route
exports.googleAuthCallback = (req, res, next) => {
    passport.authenticate("google", { failureRedirect: "/signup" })(req, res, () => {
        res.redirect("/dashboard");
    });
};

// Logout Route
exports.logout = (req, res) => {
    req.logout((err) => {
        if (err) return res.status(500).json({ message: "Logout failed" });
        res.redirect("/");
    });
};

