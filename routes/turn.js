// routes/turn.js - Fixed version
const express = require('express');
const twilio = require('twilio');

const router = express.Router();

router.get("/turn-credentials", async (req, res) => {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    // Check if credentials are configured
    if (!accountSid || !authToken) {
      return res.status(500).json({
        success: false,
        message: 'Twilio credentials not configured',
        iceServers: [
          // Fallback to public STUN servers
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
    }

    const client = twilio(accountSid, authToken);
    
    // Properly await the token creation
    const token = await client.tokens.create();

    res.json({
      success: true,
      iceServers: token.iceServers,
    });
  } catch (err) {
    console.error('Twilio TURN error:', err);
    res.status(500).json({
      success: false,
      message: err.message,
      iceServers: [
        // Fallback to public STUN servers
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
  }
});

module.exports = router;