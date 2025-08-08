const Meeting = require('../models/Meeting');
const Class = require('../models/Class');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');

// Helper function to convert UTC date to IST string
const convertToIST = (date) => {
  if (!date) return null;
  
  const utcDate = new Date(date);
  // Add 5 hours 30 minutes for IST
  const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
  return istDate.toISOString();
};

// Helper function to convert IST input to UTC for database storage
const convertISTToUTC = (istDateString) => {
  const istDate = new Date(istDateString);
  // Subtract 5 hours 30 minutes to convert IST to UTC
  const utcDate = new Date(istDate.getTime() - (5.5 * 60 * 60 * 1000));
  return utcDate;
};

// Helper function to format meeting data with IST times
const formatMeetingWithIST = (meeting) => {
  const meetingObj = meeting.toObject ? meeting.toObject() : meeting;
  
  return {
    ...meetingObj,
    scheduledDate: convertToIST(meetingObj.scheduledDate),
    startedAt: convertToIST(meetingObj.startedAt),
    endedAt: convertToIST(meetingObj.endedAt),
    cancelledAt: convertToIST(meetingObj.cancelledAt),
    createdAt: convertToIST(meetingObj.createdAt),
    updatedAt: convertToIST(meetingObj.updatedAt),
    attendees: meetingObj.attendees?.map(attendee => ({
      ...attendee,
      joinedAt: convertToIST(attendee.joinedAt),
      leftAt: convertToIST(attendee.leftAt)
    })) || []
  };
};

// Helper function to generate unique meeting room ID
const generateMeetingRoomId = () => {
  return `room_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
};

// Helper function to generate meeting access token (for future WebRTC integration)
const generateMeetingToken = (userId, meetingId, role = 'participant') => {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
  return {
    token: `${userId}_${meetingId}_${Date.now()}`,
    expires: convertToIST(expiresAt)
  };
};

// Create/Schedule a new meeting
exports.scheduleMeeting = async (req, res) => {
  try {
    const {
      title,
      description,
      classId,
      scheduledDate, // Expected to be in IST from frontend
      duration,
      isPrivate,
      maxParticipants,
      chatEnabled,
      screenShareEnabled
    } = req.body;

    const userId = req.user.id;
    
    // Validation
    if (!title || !classId || !scheduledDate || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Title, class ID, scheduled date, and duration are required'
      });
    }

    // Convert IST input to UTC for comparison and storage
    const scheduledDateUTC = convertISTToUTC(scheduledDate);
    
    if (scheduledDateUTC <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Meeting must be scheduled for a future date'
      });
    }

    // Check class exists and user has permission
    const classObj = await Class.findById(classId);
    if (!classObj) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    const hasPermission = classObj.createdBy.toString() === userId ||
                         classObj.coordinators.includes(userId);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Only class creators and coordinators can schedule meetings'
      });
    }

    // Generate unique room ID
    const roomId = generateMeetingRoomId();
    
    // Create new meeting (store in UTC)
    const newMeeting = new Meeting({
      title,
      description,
      classId,
      scheduledBy: userId,
      scheduledDate: scheduledDateUTC,
      duration,
      roomId,
      isPrivate: isPrivate || false,
      maxParticipants: maxParticipants || 50,
      chatEnabled: chatEnabled !== false, // Default true
      screenShareEnabled: screenShareEnabled !== false // Default true
    });

    await newMeeting.save();

    // Populate the meeting with user and class details
    await newMeeting.populate([
      { path: 'scheduledBy', select: 'name email' },
      { path: 'classId', select: 'className subject' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Meeting scheduled successfully',
      meeting: formatMeetingWithIST(newMeeting)
    });

  } catch (error) {
    console.error('Error scheduling meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule meeting',
      error: error.message
    });
  }
};

// Get all meetings for a class
exports.getClassMeetings = async (req, res) => {
  try {
    const { classId } = req.params;
    const { status, upcoming, past } = req.query;
    const userId = req.user.id;

    // Check if class exists and user has access
    const classObj = await Class.findById(classId);
    if (!classObj) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    const hasAccess = classObj.privacy === 'public' ||
                     classObj.createdBy.toString() === userId ||
                     classObj.students.includes(userId) ||
                     classObj.coordinators.includes(userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let query = { classId };
    
    if (status) {
      query.status = status;
    }

    // For date filtering, we work with UTC in database but convert for comparison
    if (upcoming === 'true') {
      query.scheduledDate = { $gte: new Date() }; // UTC comparison
      query.status = { $in: ['scheduled', 'active'] };
    }

    if (past === 'true') {
      query.scheduledDate = { $lt: new Date() }; // UTC comparison  
      query.status = { $in: ['completed', 'cancelled'] };
    }

    const meetings = await Meeting.find(query)
      .populate('scheduledBy', 'name email')
      .populate('classId', 'className subject')
      .sort({ scheduledDate: 1 });

    // Convert all times to IST for frontend
    const meetingsWithIST = meetings.map(meeting => formatMeetingWithIST(meeting));

    res.status(200).json({
      success: true,
      meetings: meetingsWithIST,
      count: meetingsWithIST.length,
      timezone: 'IST (UTC+5:30)'
    });

  } catch (error) {
    console.error('Error fetching class meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meetings',
      error: error.message
    });
  }
};

// Get meeting details
exports.getMeetingById = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const userId = req.user.id;

    const meeting = await Meeting.findById(meetingId)
      .populate('scheduledBy', 'name email')
      .populate('classId', 'className subject createdBy')
      .populate('attendees.userId', 'name email');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check if user has access to this meeting
    const classObj = await Class.findById(meeting.classId._id);
    const hasAccess = classObj.privacy === 'public' ||
                     classObj.createdBy.toString() === userId ||
                     classObj.students.includes(userId) ||
                     classObj.coordinators.includes(userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.status(200).json({
      success: true,
      meeting: formatMeetingWithIST(meeting),
      timezone: 'IST (UTC+5:30)'
    });

  } catch (error) {
    console.error('Error fetching meeting details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting details',
      error: error.message
    });
  }
};

// Cancel meeting
exports.cancelMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const userId = req.user.id;

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check permission
    const classObj = await Class.findById(meeting.classId);
    const hasPermission = meeting.scheduledBy.toString() === userId ||
                         classObj.createdBy.toString() === userId ||
                         classObj.coordinators.includes(userId);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied'
      });
    }

    // Can't cancel active meetings
    if (meeting.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel active meeting. Please end the meeting instead.'
      });
    }

    meeting.status = 'cancelled';
    meeting.cancelledAt = new Date();
    await meeting.save();

    // Emit cancellation notification via socket (if available)
    const io = req.app.get('io');
    if (io) {
      io.to(`class_${meeting.classId}`).emit('meeting_cancelled', {
        meetingId: meeting._id,
        title: meeting.title,
        message: 'Meeting has been cancelled',
        timestamp: convertToIST(new Date())
      });
    }

    res.status(200).json({
      success: true,
      message: 'Meeting cancelled successfully',
      cancelledAt: convertToIST(meeting.cancelledAt)
    });

  } catch (error) {
    console.error('Error cancelling meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel meeting',
      error: error.message
    });
  }
};

// Join meeting
exports.joinMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const userId = req.user.id;

    const meeting = await Meeting.findById(meetingId)
      .populate('scheduledBy', 'name email')
      .populate('classId', 'className subject');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check if meeting is cancelled
    if (meeting.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Meeting has been cancelled'
      });
    }

    // Check if user has access
    const classObj = await Class.findById(meeting.classId._id);
    const hasAccess = classObj.privacy === 'public' ||
                     classObj.createdBy.toString() === userId ||
                     classObj.students.includes(userId) ||
                     classObj.coordinators.includes(userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if meeting has reached max participants
    const activeAttendees = meeting.attendees.filter(att => !att.leftAt).length;
    if (activeAttendees >= meeting.maxParticipants) {
      return res.status(400).json({
        success: false,
        message: 'Meeting has reached maximum capacity'
      });
    }

    // Check if already joined and still active
    const existingAttendee = meeting.attendees.find(
      attendee => attendee.userId.toString() === userId && !attendee.leftAt
    );

    if (existingAttendee) {
      // Return existing session info
      const userRole = meeting.scheduledBy._id.toString() === userId ? 'moderator' : 'participant';
      const accessToken = generateMeetingToken(userId, meetingId, userRole);

      return res.status(200).json({
        success: true,
        message: 'Already in meeting',
        meeting: {
          ...formatMeetingWithIST(meeting),
          _id: meeting._id,
          title: meeting.title,
          roomId: meeting.roomId,
          status: meeting.status,
          chatEnabled: meeting.chatEnabled,
          screenShareEnabled: meeting.screenShareEnabled
        },
        accessToken: accessToken.token,
        tokenExpires: accessToken.expires,
        userRole,
        joinedAt: convertToIST(existingAttendee.joinedAt),
        timezone: 'IST (UTC+5:30)'
      });
    }

    // Add to attendees
    const joinTime = new Date();
    meeting.attendees.push({
      userId,
      joinedAt: joinTime
    });

    // Update meeting status to active if it's the first attendee
    if (meeting.status === 'scheduled') {
      meeting.status = 'active';
      meeting.startedAt = joinTime;
    }

    await meeting.save();

    // Determine user role
    const userRole = meeting.scheduledBy._id.toString() === userId ? 'moderator' : 'participant';
    
    // Generate access token for video call
    const accessToken = generateMeetingToken(userId, meetingId, userRole);

    // Emit join notification via socket (if available)
    const io = req.app.get('io');
    if (io) {
      io.to(`class_${meeting.classId._id}`).emit('user_joined_meeting', {
        meetingId: meeting._id,
        userId,
        userName: req.user.name,
        joinedAt: convertToIST(joinTime),
        activeParticipants: meeting.attendees.filter(att => !att.leftAt).length
      });
    }

    res.status(200).json({
      success: true,
      message: 'Successfully joined the meeting',
      meeting: {
        ...formatMeetingWithIST(meeting),
        _id: meeting._id,
        title: meeting.title,
        description: meeting.description,
        roomId: meeting.roomId,
        status: meeting.status,
        scheduledBy: meeting.scheduledBy,
        classId: meeting.classId,
        chatEnabled: meeting.chatEnabled,
        screenShareEnabled: meeting.screenShareEnabled
      },
      accessToken: accessToken.token,
      tokenExpires: accessToken.expires,
      userRole,
      activeParticipants: meeting.attendees.filter(att => !att.leftAt).length,
      timezone: 'IST (UTC+5:30)'
    });

  } catch (error) {
    console.error('Error joining meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join meeting',
      error: error.message
    });
  }
};

// Leave meeting
exports.leaveMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const userId = req.user.id;

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Find the attendee record
    const attendeeIndex = meeting.attendees.findIndex(
      attendee => attendee.userId.toString() === userId && !attendee.leftAt
    );

    if (attendeeIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'Not currently in the meeting'
      });
    }

    // Update leave time and calculate duration
    const leaveTime = new Date();
    const attendee = meeting.attendees[attendeeIndex];
    attendee.leftAt = leaveTime;
    attendee.duration = Math.round((leaveTime - attendee.joinedAt) / 60000); // Duration in minutes

    // Check if this was the last participant
    const remainingParticipants = meeting.attendees.filter(att => !att.leftAt && att.userId.toString() !== userId).length;
    
    // Auto-end meeting if no participants left and it's been active for more than 5 minutes
    if (remainingParticipants === 0 && meeting.status === 'active') {
      const meetingDuration = Math.round((leaveTime - meeting.startedAt) / 60000);
      if (meetingDuration >= 5) {
        meeting.status = 'completed';
        meeting.endedAt = leaveTime;
        meeting.actualDuration = meetingDuration;
      }
    }

    await meeting.save();

    // Emit leave notification via socket (if available)
    const io = req.app.get('io');
    if (io) {
      io.to(`class_${meeting.classId}`).emit('user_left_meeting', {
        meetingId: meeting._id,
        userId,
        leftAt: convertToIST(attendee.leftAt),
        duration: attendee.duration,
        activeParticipants: remainingParticipants
      });
    }

    res.status(200).json({
      success: true,
      message: 'Successfully left the meeting',
      leftAt: convertToIST(attendee.leftAt),
      duration: attendee.duration,
      activeParticipants: remainingParticipants,
      timezone: 'IST (UTC+5:30)'
    });

  } catch (error) {
    console.error('Error leaving meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave meeting',
      error: error.message
    });
  }
};

// End meeting (for moderators)
exports.endMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const userId = req.user.id;

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check permission
    const classObj = await Class.findById(meeting.classId);
    const hasPermission = meeting.scheduledBy.toString() === userId ||
                         classObj.createdBy.toString() === userId ||
                         classObj.coordinators.includes(userId);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Only moderators can end the meeting'
      });
    }

    if (meeting.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Meeting is not active'
      });
    }

    // Update all active attendees to left
    const endTime = new Date();
    meeting.attendees.forEach(attendee => {
      if (!attendee.leftAt) {
        attendee.leftAt = endTime;
        attendee.duration = Math.round((endTime - attendee.joinedAt) / 60000);
      }
    });

    // Mark meeting as completed
    meeting.status = 'completed';
    meeting.endedAt = endTime;
    if (meeting.startedAt) {
      meeting.actualDuration = Math.round((endTime - meeting.startedAt) / 60000);
    }

    await meeting.save();

    // Emit meeting ended notification (if available)
    const io = req.app.get('io');
    if (io) {
      io.to(`class_${meeting.classId}`).emit('meeting_ended', {
        meetingId: meeting._id,
        endedBy: userId,
        endedAt: convertToIST(endTime),
        message: 'Meeting has been ended by the moderator'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Meeting ended successfully',
      endedAt: convertToIST(meeting.endedAt),
      duration: meeting.actualDuration,
      timezone: 'IST (UTC+5:30)'
    });

  } catch (error) {
    console.error('Error ending meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end meeting',
      error: error.message
    });
  }
};

// Get meeting analytics/stats
exports.getMeetingStats = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const userId = req.user.id;

    const meeting = await Meeting.findById(meetingId)
      .populate('attendees.userId', 'name email')
      .populate('scheduledBy', 'name email')
      .populate('classId', 'className subject');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check permission
    const classObj = await Class.findById(meeting.classId._id);
    const hasPermission = meeting.scheduledBy._id.toString() === userId ||
                         classObj.createdBy.toString() === userId ||
                         classObj.coordinators.includes(userId);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied'
      });
    }

    // Calculate stats
    const totalAttendees = meeting.attendees.length;
    const averageDuration = totalAttendees > 0 
      ? Math.round(meeting.attendees.reduce((sum, att) => sum + (att.duration || 0), 0) / totalAttendees)
      : 0;
    
    res.status(200).json({
      success: true,
      stats: {
        meetingId: meeting._id,
        title: meeting.title,
        scheduledDate: convertToIST(meeting.scheduledDate),
        startedAt: convertToIST(meeting.startedAt),
        endedAt: convertToIST(meeting.endedAt),
        status: meeting.status,
        totalAttendees,
        averageDuration,
        actualDuration: meeting.actualDuration,
        attendees: meeting.attendees.map(att => ({
          user: att.userId,
          joinedAt: convertToIST(att.joinedAt),
          leftAt: convertToIST(att.leftAt),
          duration: att.duration
        }))
      },
      timezone: 'IST (UTC+5:30)'
    });

  } catch (error) {
    console.error('Error fetching meeting stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting statistics',
      error: error.message
    });
  }
};