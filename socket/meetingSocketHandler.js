const Meeting = require('../models/Meeting');

// Meeting-related socket handlers
const setupMeetingHandlers = (socket, io) => {
  const sendError = (message, code = 'MEETING_ERROR') => {
    if (socket && socket.connected) {
      socket.emit('error', { 
        message, 
        code, 
        timestamp: new Date().toISOString() 
      });
    }
  };

  const { activeUsers } = require('./socketHandler');

  // Helper function to handle meeting events
  const handleMeetingEvent = (eventType, data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user?.classId) {
        sendError('You must join a class first', 'CLASS_ERROR');
        return;
      }

      const eventData = {
        id: Date.now().toString(),
        type: eventType,
        classId: user.classId,
        timestamp: new Date(),
        ...data
      };

      if (eventType === 'meeting_scheduled') {
        eventData.scheduledBy = {
          userId: socket.userId,
          userName: socket.userName,
          userRole: socket.userRole
        };
      } else if (eventType === 'meeting_started') {
        eventData.startedBy = {
          userId: socket.userId,
          userName: socket.userName
        };
      }

      io.to(`class_${user.classId}`).emit(eventType === 'meeting_scheduled' ? 'meeting_notification' : eventType, eventData);
    } catch (error) {
      console.error(`❌ Error handling meeting event ${eventType}:`, error);
      sendError('Failed to process meeting event', 'SERVER_ERROR');
    }
  };

  // Schedule meeting
  socket.on('schedule_meeting', (data) => {
    handleMeetingEvent('meeting_scheduled', {
      title: data.title,
      scheduledDate: data.scheduledDate,
      duration: data.duration,
      meetingLink: data.meetingLink
    });
  });

  // Meeting reminder
  socket.on('meeting_reminder', (data) => {
    handleMeetingEvent('meeting_reminder', {
      meetingId: data.meetingId,
      title: data.title,
      scheduledDate: data.scheduledDate,
      minutesUntilMeeting: data.minutesUntilMeeting,
      meetingLink: data.meetingLink
    });
  });

  // Start meeting (FIXED status)
  socket.on('meeting_started', async (data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user?.classId) {
        sendError('You must join a class first', 'CLASS_ERROR');
        return;
      }

      const { meetingId, title, meetingLink } = data;

      // ✅ FIXED: Update meeting status in database with correct status
      if (meetingId) {
        try {
          await Meeting.findByIdAndUpdate(meetingId, {
            status: 'active', // ✅ FIXED: Use 'active' instead of 'live'
            startedAt: new Date(),
            startedBy: socket.userId
          });
          console.log(`📊 Meeting ${meetingId} status updated to 'active'`);
        } catch (dbError) {
          console.error('❌ Error updating meeting status:', dbError);
        }
      }

      const eventData = {
        id: meetingId || Date.now().toString(),
        type: 'meeting_started',
        classId: user.classId,
        timestamp: new Date(),
        title,
        meetingLink,
        startedBy: {
          userId: socket.userId,
          userName: socket.userName
        }
      };

      io.to(`class_${user.classId}`).emit('meeting_started', eventData);
      console.log(`🎬 Meeting started by ${socket.userName} in class ${user.classId}`);

    } catch (error) {
      console.error('❌ Error handling meeting_started:', error);
      sendError('Failed to start meeting', 'SERVER_ERROR');
    }
  });

  // End meeting (FIXED status)
  socket.on('meeting_ended', async (data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user?.classId) {
        sendError('You must join a class first', 'CLASS_ERROR');
        return;
      }

      const { meetingId } = data;

      // ✅ FIXED: Update meeting status in database with correct status
      if (meetingId) {
        try {
          await Meeting.findByIdAndUpdate(meetingId, {
            status: 'completed', // ✅ FIXED: Use 'completed' instead of 'ended'
            endedAt: new Date()
          });
          console.log(`📊 Meeting ${meetingId} status updated to 'completed'`);
        } catch (dbError) {
          console.error('❌ Error updating meeting status:', dbError);
        }
      }

      const eventData = {
        id: meetingId || Date.now().toString(),
        type: 'meeting_ended',
        classId: user.classId,
        timestamp: new Date(),
        endedBy: {
          userId: socket.userId,
          userName: socket.userName
        }
      };

      io.to(`class_${user.classId}`).emit('meeting_ended', eventData);
      
    } catch (error) {
      console.error('❌ Error ending meeting:', error);
      sendError('Failed to end meeting', 'SERVER_ERROR');
    }
  });

  // Meeting join notification
  socket.on('user_joined_meeting', (data) => {
    const user = activeUsers.get(socket.id);
    if (user?.classId) {
      socket.to(`class_${user.classId}`).emit('user_joined_meeting', {
        meetingId: data.meetingId,
        userId: socket.userId,
        userName: socket.userName,
        timestamp: new Date()
      });
    }
  });

  // Meeting leave notification
  socket.on('user_left_meeting', (data) => {
    const user = activeUsers.get(socket.id);
    if (user?.classId) {
      socket.to(`class_${user.classId}`).emit('user_left_meeting', {
        meetingId: data.meetingId,
        userId: socket.userId,
        userName: socket.userName,
        timestamp: new Date()
      });
    }
  });
};

module.exports = {
  setupMeetingHandlers
};