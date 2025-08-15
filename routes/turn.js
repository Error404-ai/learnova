// routes/turn.js - Debug version
const express = require('express');
const twilio = require('twilio');

const router = express.Router();

// Add a simple test route
router.get("/test", (req, res) => {
  res.json({ message: "TURN route is working!" });
});

router.get("/turn-credentials", async (req, res) => {
  console.log("🔄 TURN credentials requested");
  
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    console.log("📝 Twilio Account SID:", accountSid ? "SET" : "NOT SET");
    console.log("📝 Twilio Auth Token:", authToken ? "SET" : "NOT SET");

    // Check if credentials are configured
    if (!accountSid || !authToken) {
      console.log("❌ Twilio credentials not configured");
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

    console.log("🔄 Creating Twilio client...");
    const client = twilio(accountSid, authToken);
    
    console.log("🔄 Requesting TURN token from Twilio...");
    const token = await client.tokens.create();
    
    console.log("✅ TURN token received:", token.iceServers?.length || 0, "servers");

    res.json({
      success: true,
      iceServers: token.iceServers,
    });
  } catch (err) {
    console.error('❌ Twilio TURN error:', err.message);
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

console.log("📁 TURN routes module loaded successfully");

module.exports = router;