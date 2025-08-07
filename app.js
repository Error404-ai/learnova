const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const passport = require("passport");
const session = require('express-session');
const helmet = require("helmet");
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

dotenv.config();

const app = express();
const server = http.createServer(app);

const Message = require('./models/classMessage');
const User = require('./models/User');

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://learnova-one.vercel.app'
    ],
    credentials: true,
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

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
  socket.emit('error', { 
    message, 
    code, 
    timestamp: new Date().toISOString() 
  });
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

const broadcastActiveUsers = (classId) => {
  const activeClassUsers = Array.from(classRooms.get(classId) || [])
    .map(socketId => activeUsers.get(socketId))
    .filter(Boolean);
  io.to(`class_${classId}`).emit('active_users', activeClassUsers);
};

const sendClassMessages = async (socket, classId) => {
  try {
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
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication token required'));
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id || decoded.userId);
    
    if (!user) {
      return next(new Error('User not found'));
    }
    
    socket.userId = user._id.toString();
    socket.userName = user.name;
    socket.userRole = user.role;
    socket.userEmail = user.email;
    next();
  } catch (error) {
    const errorMessages = {
      'JsonWebTokenError': 'Invalid token',
      'TokenExpiredError': 'Token expired'
    };
    return next(new Error(errorMessages[error.name] || 'Authentication failed'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.userName} (${socket.userRole}) - Socket ID: ${socket.id}`);
  
  socket.on('joinClass', (data) => {
    const { classId } = data;
    
    if (!classId) {
      sendError(socket, 'Class ID is required', 'VALIDATION_ERROR');
      return;
    }
 
    // Leave all rooms except socket's own room
    Array.from(socket.rooms).forEach(room => {
      if (room !== socket.id) socket.leave(room);
    });
    
    socket.join(`class_${classId}`);
    activeUsers.set(socket.id, {
      userId: socket.userId,
      userName: socket.userName,
      classId,
      userRole: socket.userRole,
      joinedAt: new Date()
    });
    
    if (!classRooms.has(classId)) {
      classRooms.set(classId, new Set());
    }
    classRooms.get(classId).add(socket.id);
    
    broadcastActiveUsers(classId);
    sendClassMessages(socket, classId);
    
    console.log(`User ${socket.userName} joined class ${classId} as ${socket.userRole}`);
  });

  socket.on('sendMessage', async (data) => {
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

    try {
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
      console.log('Message sent successfully');
      
    } catch (error) {
      console.error('Error saving message:', error);
      
      if (error.name === 'ValidationError') {
        sendError(socket, `Validation failed: ${error.message}`, 'VALIDATION_ERROR');
      } else {
        sendError(socket, 'Failed to send message', 'SERVER_ERROR');
      }
    }
  });

  socket.on('send_announcement', async (data) => {
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

    try {
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
      console.error('Error saving/sending announcement:', error);
      sendError(socket, 'Failed to send announcement', 'SERVER_ERROR');
    }
  });

  // Meeting handlers
  const handleMeetingEvent = (eventType, data) => {
    const user = activeUsers.get(socket.id);
    if (!user?.classId) return;

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
  };

  socket.on('schedule_meeting', (data) => {
    handleMeetingEvent('meeting_scheduled', {
      title: data.title,
      scheduledDate: data.scheduledDate,
      duration: data.duration,
      meetingLink: data.meetingLink
    });
  });

  socket.on('meeting_reminder', (data) => {
    handleMeetingEvent('meeting_reminder', {
      meetingId: data.meetingId,
      title: data.title,
      scheduledDate: data.scheduledDate,
      minutesUntilMeeting: data.minutesUntilMeeting,
      meetingLink: data.meetingLink
    });
  });

  socket.on('meeting_started', (data) => {
    handleMeetingEvent('meeting_started', {
      meetingId: data.meetingId,
      title: data.title,
      meetingLink: data.meetingLink
    });
  });

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

  socket.on('notify_assignment', (data) => {
    if (socket.userRole?.toLowerCase() !== 'teacher') {
      sendError(socket, 'Only teachers can send assignment notifications', 'PERMISSION_ERROR');
      return;
    }
    
    if (!data.assignmentId || !data.title) {
      sendError(socket, 'Assignment ID and title are required', 'VALIDATION_ERROR');
      return;
    }
    
    const user = activeUsers.get(socket.id);
    if (user?.classId) {
      const notificationData = {
        id: Date.now().toString(),
        type: 'assignment_notification',
        assignmentId: data.assignmentId,
        title: sanitizeInput(data.title),
        dueDate: data.dueDate,
        classId: user.classId,
        timestamp: new Date(),
        teacherName: socket.userName
      };
      
      socket.to(`class_${user.classId}`).emit('assignment_notification', notificationData);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.userName} - Socket ID: ${socket.id}`);
    const user = activeUsers.get(socket.id);
    
    if (user) {
      if (classRooms.has(user.classId)) {
        classRooms.get(user.classId).delete(socket.id);
        if (classRooms.get(user.classId).size === 0) {
          classRooms.delete(user.classId);
        } else {
          broadcastActiveUsers(user.classId);
        }
      }
      activeUsers.delete(socket.id);
      messageRateLimits.delete(user.userId);
    }
  });
});

app.set('io', io);

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://learnova-one.vercel.app'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://cdn.socket.io"],
    connectSrc: [
      "'self'", 
      "ws:", 
      "wss:", 
      "http://localhost:5000", 
      "https://project2-zphf.onrender.com"
    ],
  },
}));

app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
}));

require("./config/passport");
app.use(passport.initialize());
app.use(passport.session());

app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require("./routes/userroutes");
const classRoutes = require('./routes/classroutes');
const assignmentRoutes = require('./routes/assignmentroutes');
const meetingRoutes = require('./routes/meetingRoutes');

app.use('/api/auth', authRoutes);
app.use("/user", userRoutes);
app.use('/api/class', classRoutes);
app.use('/api/assign', assignmentRoutes);
app.use('/api/meetings', meetingRoutes);

// API endpoints
app.get('/api/class/:classId/messages', async (req, res) => {
  try {
    const { classId } = req.params;
    const messages = await Message.find({ classId })
      .populate('sender', 'name role')
      .sort({ timestamp: 1 });
      
    const formattedMessages = messages.map(msg => ({
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
    
    res.json({ success: true, messages: formattedMessages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch messages' });
  }
});

app.get('/api/class/:classId/active-users', (req, res) => {
  const { classId } = req.params;
  const activeClassUsers = Array.from(classRooms.get(classId) || [])
    .map(socketId => activeUsers.get(socketId))
    .filter(Boolean);

  res.json({
    success: true,
    classId,
    activeUsers: activeClassUsers,
    count: activeClassUsers.length
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'API is running successfully!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    activeConnections: activeUsers.size,
    activeClasses: classRooms.size
  });
});

// Error handling
app.use((err, req, res, next) => {
  if (err.message?.includes('CORS')) {
    return res.status(403).json({
      success: false,
      message: 'CORS Error: Origin not allowed'
    });
  }
  
  console.error('Application error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    method: req.method
  });
});

// Database connection and server startup
(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
})();

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('Shutting down gracefully...');
  io.close(() => {
    mongoose.connection.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Clean up rate limits periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [userId, limit] of messageRateLimits.entries()) {
    if (now > limit.resetTime) {
      messageRateLimits.delete(userId);
    }
  }
}, 5 * 60 * 1000);