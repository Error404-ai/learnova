const express = require('express');
const router = express.Router();
const Message = require('./models/Message'); 

router.get('/api/class/:classId/messages', async (req, res) => {
    try {
        const { classId } = req.params;
        const messages = await Message.find({ classId }).sort({ timestamp: 1 });
        res.json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch messages' });
    }
});

module.exports = router;