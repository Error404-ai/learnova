const express = require('express');
const router = express.Router();
const {
  scheduleMeeting,
  getClassMeetings,
  getMeetingById,
  cancelMeeting,
  joinMeeting,
  leaveMeeting,
  endMeeting,
  getMeetingStats,startMeeting
} = require('../controllers/meetingControllers');

const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

// Meeting CRUD routes
router.post('/schedule', scheduleMeeting);          
router.get('/class/:classId', getClassMeetings);    
router.get('/:meetingId', getMeetingById);         
router.delete('/:meetingId/cancel', cancelMeeting); 

// Meeting participation routes
router.post('/:meetingId/start', startMeeting); 
router.post('/:meetingId/join', joinMeeting);      
router.post('/:meetingId/leave', leaveMeeting);    
router.post('/:meetingId/end', endMeeting);         
router.get('/:meetingId/stats', getMeetingStats);   
module.exports = router;