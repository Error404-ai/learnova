// routes/meetingRoutes.js
const express = require('express');
const router = express.Router();
const meetingController = require('../controllers/meetingControllers');
const { protect } = require('../middlewares/authMiddleware');
router.use(protect);
router.post('/schedule', meetingController.scheduleMeeting);
router.get('/class/:classId', meetingController.getClassMeetings);
router.get('/upcoming', meetingController.getUserUpcomingMeetings);
router.get('/:meetingId', meetingController.getMeetingById);
router.put('/:meetingId', meetingController.updateMeeting);
router.patch('/:meetingId/cancel', meetingController.cancelMeeting);
router.post('/:meetingId/join', meetingController.joinMeeting);
router.post('/:meetingId/leave', meetingController.leaveMeeting);

module.exports = router;