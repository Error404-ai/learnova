import express from 'express';
import twilio from 'twilio';
import dotenv from 'dotenv';
import cors from 'cors'; 

dotenv.config();

const app = express();
app.use(cors());
// Load from .env
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = twilio(accountSid, authToken);

// Endpoint to fetch TURN/STUN credentials
app.get('/turn-credentials', async (req, res) => {
  try {
    const token = await client.tokens.create();
    res.json(token);
  } catch (error) {
    console.error('Error fetching TURN credentials:', error);
    res.status(500).send('Failed to get TURN credentials');
  }
});

app.listen(3000, () => {
  console.log('TURN credentials server running on port 3000');
});
