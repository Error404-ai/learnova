const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/classMessage');

// In-memory stores
const activeUsers = new Map();
const classRooms = new Map();
const messageRateLimits = new Map();

// Utility functions
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  return input.trim().substring(0, 1000);
};

const sendError = (socket, message, code = 'GENERAL_ERROR') => {
  if (socket && socket.connected) {
    socket.emit('error', { 
      message, 
      code, 
      timestamp: new Date().toISOString() 
    });
  }
};

const validateMessageRate = (userId) => {
  const now = Date.now();
  const userLimit = messageRateLimits.get(userId) || { count: 0, resetTime: now + 60000 };
  
  if (now > userLimit.resetTime) {
    userLimit.count = 0;
    userLimit.resetTime = now + 60000;
  }
  
  if (userLimit.count >= 10) return false;
  
  userLimit.count++;
  messageRateLimits.set(userId, userLimit);
  return true;
};

const broadcastActiveUsers = (classId, io) => {
  const activeClassUsers = Array.from(classRooms.get(classId) || [])
    .map(socketId => activeUsers.get(socketId))
    .filter(Boolean);
  io.to(`class_${classId}`).emit('active_users', activeClassUsers);
};

const sendClassMessages = async (socket, classId) => {
  try {
    if (!socket || !socket.connected) return;
    
    const messages = await Message.find({ classId })
      .populate('sender', 'name role')
      .sort({ timestamp: -1 })
      .limit(50);
      
    const formattedMessages = messages.reverse().map(msg => ({
      _id: msg._id,
      content: msg.content,
      sender: {
        _id: msg.sender._id,
        name: msg.sender.name,
        role: msg.sender.role,
      },
      classId: msg.classId,
      timestamp: msg.timestamp,
      type: msg.type,
    }));
    
    socket.emit('classMessages', formattedMessages);
  } catch (error) {
    console.error('Error sending class messages:', error);
  }
};

// Socket.IO middleware
const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    
    if (!token) {
      console.log('❌ No authentication token provided');
      return next(new Error('Authentication token required'));
    }
    
    const cleanToken = token.replace(/^Bearer\s+/i, '');
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id || decoded.userId).select('_id name role email');
    
    if (!user) {
      console.log('❌ User not found for token');
      return next(new Error('User not found'));
    }
    
    socket.userId = user._id.toString();
    socket.userName = user.name;
    socket.userRole = user.role;
    socket.userEmail = user.email;
    
    console.log(`✅ Socket authenticated: ${user.name} (${user.role})`);
    next();
  } catch (error) {
    console.error('❌ Socket authentication error:', error.message);
    const errorMessages = {
      'JsonWebTokenError': 'Invalid token',
      'TokenExpiredError': 'Token expired',
      'NotBeforeError': 'Token not active'
    };
    return next(new Error(errorMessages[error.name] || 'Authentication failed'));
  }
};

// Main socket handler
const handleConnection = (io) => {
  return (socket) => {
    console.log(`✅ User connected: ${socket.userName} (${socket.userRole}) - Socket ID: ${socket.id}`);
    
    // Class management handlers
    socket.on('joinClass', async (data) => {
      try {
        const { classId } = data;
        
        if (!classId) {
          sendError(socket, 'Class ID is required', 'VALIDATION_ERROR');
          return;
        }
     
        // Leave all rooms except socket's own room
        Array.from(socket.rooms).forEach(room => {
          if (room !== socket.id) {
            socket.leave(room);
          }
        });
        
        socket.join(`class_${classId}`);
        
        // Update active users
        activeUsers.set(socket.id, {
          userId: socket.userId,
          userName: socket.userName,
          classId,
          userRole: socket.userRole,
          joinedAt: new Date()
        });
        
        // Update class rooms
        if (!classRooms.has(classId)) {
          classRooms.set(classId, new Set());
        }
        classRooms.get(classId).add(socket.id);
        
        socket.emit('class_joined', {
          success: true,
          classId,
          message: `Successfully joined class ${classId}`
        });
        
        broadcastActiveUsers(classId, io);
        await sendClassMessages(socket, classId);
        
        console.log(`✅ User ${socket.userName} joined class ${classId} as ${socket.userRole}`);
      } catch (error) {
        console.error('❌ Error in joinClass:', error);
        sendError(socket, 'Failed to join class', 'SERVER_ERROR');
      }
    });

    // Message handlers
    socket.on('sendMessage', async (data) => {
      try {
        const user = activeUsers.get(socket.id);

        if (!user?.classId) {
          sendError(socket, 'You must join a class first', 'CLASS_ERROR');
          return;
        }

        const sanitizedContent = sanitizeInput(data.content);
        if (!sanitizedContent) {
          sendError(socket, 'Message content is required', 'VALIDATION_ERROR');
          return;
        }

        if (!validateMessageRate(user.userId)) {
          sendError(socket, 'Rate limit exceeded', 'RATE_LIMIT_ERROR');
          return;
        }

        const newMessage = new Message({
          sender: user.userId,
          content: sanitizedContent,
          classId: user.classId,
          type: data.type || 'message'
        });
        
        await newMessage.save();

        const responseData = {
          _id: newMessage._id,
          sender: {
            _id: user.userId,
            name: user.userName,
            role: user.userRole,
          },
          content: newMessage.content,
          classId: user.classId,
          timestamp: newMessage.timestamp,
          type: newMessage.type
        };

        io.to(`class_${user.classId}`).emit('newMessage', responseData);
        console.log(`✅ Message sent by ${user.userName} in class ${user.classId}`);
        
      } catch (error) {
        console.error('❌ Error saving message:', error);
        
        if (error.name === 'ValidationError') {
          sendError(socket, `Validation failed: ${error.message}`, 'VALIDATION_ERROR');
        } else {
          sendError(socket, 'Failed to send message', 'SERVER_ERROR');
        }
      }
    });

    // Announcement handlers
    socket.on('send_announcement', async (data) => {
      try {
        const user = activeUsers.get(socket.id);
        const sanitizedMessage = sanitizeInput(data.message);
        
        if (!sanitizedMessage) {
          sendError(socket, 'Announcement message is required', 'VALIDATION_ERROR');
          return;
        }

        if (!user?.classId) {
          sendError(socket, 'You must join a class first', 'CLASS_ERROR');
          return;
        }

        const newAnnouncement = new Message({
          sender: socket.userId,
          content: sanitizedMessage,
          classId: user.classId,
          type: 'announcement'
        });

        await newAnnouncement.save();

        const broadcastData = {
          _id: newAnnouncement._id,
          id: Date.now().toString(),
          userId: socket.userId,
          userName: socket.userName,
          userRole: socket.userRole || 'teacher',
          message: sanitizedMessage,
          content: sanitizedMessage,
          description: data.description ? sanitizeInput(data.description) : undefined,
          classId: user.classId,
          timestamp: newAnnouncement.timestamp,
          type: 'announcement',
          urgent: data.urgent || false,
          sender: {
            _id: socket.userId,
            name: socket.userName,
            role: socket.userRole || 'teacher'
          }
        };

        io.to(`class_${user.classId}`).emit('receive_announcement', broadcastData);
        socket.emit('announcement_sent', { 
          success: true, 
          message: 'Announcement sent successfully',
          announcementId: broadcastData._id 
        });
        
      } catch (error) {
        console.error('❌ Error saving/sending announcement:', error);
        sendError(socket, 'Failed to send announcement', 'SERVER_ERROR');
      }
    });

    // Meeting handlers (with FIXED status values)
    socket.on('meeting_started', async (data) => {
      try {
        const user = activeUsers.get(socket.id);
        if (!user?.classId) {
          sendError(socket, 'You must join a class first', 'CLASS_ERROR');
          return;
        }

        const { meetingId, title, meetingLink } = data;

        // FIXED: Update meeting status in database with correct status
        if (meetingId) {
          try {
            const Meeting = require('../models/Meeting');
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
        sendError(socket, 'Failed to start meeting', 'SERVER_ERROR');
      }
    });

    socket.on('meeting_ended', async (data) => {
      try {
        const user = activeUsers.get(socket.id);
        if (!user?.classId) {
          sendError(socket, 'You must join a class first', 'CLASS_ERROR');
          return;
        }

        const { meetingId } = data;

        // FIXED: Update meeting status in database with correct status
        if (meetingId) {
          try {
            const Meeting = require('../models/Meeting');
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
        sendError(socket, 'Failed to end meeting', 'SERVER_ERROR');
      }
    });

    // Other handlers...
    socket.on('ask_question', (data) => {
      const user = activeUsers.get(socket.id);
      const sanitizedQuestion = sanitizeInput(data.question);
      
      if (!sanitizedQuestion) {
        sendError(socket, 'Question is required', 'VALIDATION_ERROR');
        return;
      }
      
      if (user?.classId) {
        const questionData = {
          id: Date.now().toString(),
          userId: socket.userId,
          userName: socket.userName,
          userRole: socket.userRole,
          question: sanitizedQuestion,
          classId: user.classId,
          timestamp: new Date(),
          type: 'question',
          isAnonymous: data.isAnonymous || false
        };
        
        io.to(`class_${user.classId}`).emit('receive_question', questionData);
      }
    });

    // Disconnect handler
    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.userName} - Socket ID: ${socket.id}`);
     
      // Import video cleanup function
      const { cleanupVideoCallResources } = require('./videoCallHandler');
      await cleanupVideoCallResources(socket.id, io);
      
      const user = activeUsers.get(socket.id);
      if (user) {
        if (classRooms.has(user.classId)) {
          classRooms.get(user.classId).delete(socket.id);
          if (classRooms.get(user.classId).size === 0) {
            classRooms.delete(user.classId);
          } else {
            broadcastActiveUsers(user.classId, io);
          }
        }
        activeUsers.delete(socket.id);
        messageRateLimits.delete(user.userId);
      }
    });
  };
};

// Clean up rate limits periodically (every 5 minutes)
const startCleanupInterval = () => {
  setInterval(() => {
    const now = Date.now();
    for (const [userId, limit] of messageRateLimits.entries()) {
      if (now > limit.resetTime) {
        messageRateLimits.delete(userId);
      }
    }
  }, 5 * 60 * 1000);
};

module.exports = {
  socketAuth,
  handleConnection,
  startCleanupInterval,
  activeUsers,
  classRooms,
  sendClassMessages,
  broadcastActiveUsers
};