// routes/turn.js
import express from "express";
import twilio from "twilio";

const router = express.Router();

router.get("/turn-credentials", async (req, res) => {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const client = twilio(accountSid, authToken);

    const token = client.tokens.create();
    const data = await token;

    res.json({
      success: true,
      iceServers: data.iceServers,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
