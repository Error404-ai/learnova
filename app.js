const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const passport = require("passport");
const session = require('express-session');
const helmet = require("helmet");
const path = require('path');
const fs = require('fs');
const http = require('http'); 
const { Server } = require('socket.io'); 

dotenv.config();

const app = express();
const server = http.createServer(app);

// Enhanced Socket.IO configuration
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
  // Additional configurations for production
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// Store active users and their rooms (classes)
const activeUsers = new Map();
const classRooms = new Map();

// Enhanced Socket Connection Handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User joins a specific class room
  socket.on('join_class', (data) => {
    const { userId, userName, classId, userRole } = data;
    
    // Leave any previous rooms
    Array.from(socket.rooms).forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });
    
    // Join the new class room
    socket.join(`class_${classId}`);
    
    // Store user info
    activeUsers.set(socket.id, {
      userId,
      userName,
      classId,
      userRole,
      joinedAt: new Date()
    });
    
    // Update class room info
    if (!classRooms.has(classId)) {
      classRooms.set(classId, new Set());
    }
    classRooms.get(classId).add(socket.id);
    
    console.log(`${userName} (${userRole}) joined class ${classId}`);
    
    // Send active users list to the newly joined user
    const activeClassUsers = Array.from(classRooms.get(classId) || [])
      .map(socketId => activeUsers.get(socketId))
      .filter(Boolean);
    
    socket.emit('active_users', activeClassUsers);
  });

  // Handle class messages
  socket.on('send_class_message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('error', { message: 'User not authenticated' });
      return;
    }

    const messageData = {
      id: Date.now().toString(),
      userId: user.userId,
      userName: user.userName,
      userRole: user.userRole,
      message: data.message,
      classId: user.classId,
      timestamp: new Date(),
      type: data.type || 'message' // message, announcement, question
    };

    console.log('Class message:', messageData);
    
    // Send to all users in the class
    io.to(`class_${user.classId}`).emit('receive_class_message', messageData);
  });

  // Handle teacher announcements (only teachers can send)
  socket.on('send_announcement', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user || user.userRole !== 'teacher') {
      socket.emit('error', { message: 'Only teachers can send announcements' });
      return;
    }

    const announcementData = {
      id: Date.now().toString(),
      userId: user.userId,
      userName: user.userName,
      userRole: user.userRole,
      message: data.message,
      classId: user.classId,
      timestamp: new Date(),
      type: 'announcement',
      urgent: data.urgent || false
    };

    console.log('Teacher announcement:', announcementData);
    
    // Send to all users in the class
    io.to(`class_${user.classId}`).emit('receive_announcement', announcementData);
  });

  // Handle student questions/queries
  socket.on('ask_question', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('error', { message: 'User not authenticated' });
      return;
    }

    const questionData = {
      id: Date.now().toString(),
      userId: user.userId,
      userName: user.userName,
      userRole: user.userRole,
      question: data.question,
      classId: user.classId,
      timestamp: new Date(),
      type: 'question',
      isAnonymous: data.isAnonymous || false
    };

    console.log('Student question:', questionData);
    
    // Send to all users in the class
    io.to(`class_${user.classId}`).emit('receive_question', questionData);
  });

  // Handle assignment notifications (teachers only)
  socket.on('notify_assignment', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user || user.userRole !== 'teacher') {
      socket.emit('error', { message: 'Only teachers can send assignment notifications' });
      return;
    }

    const notificationData = {
      id: Date.now().toString(),
      type: 'assignment_notification',
      assignmentId: data.assignmentId,
      title: data.title,
      dueDate: data.dueDate,
      classId: user.classId,
      timestamp: new Date(),
      teacherName: user.userName
    };

    console.log('Assignment notification:', notificationData);
    
    // Send to all students in the class
    socket.to(`class_${user.classId}`).emit('assignment_notification', notificationData);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      console.log(`User disconnected: ${user.userName} (${socket.id})`);
      
      // Remove from class room
      if (classRooms.has(user.classId)) {
        classRooms.get(user.classId).delete(socket.id);
        if (classRooms.get(user.classId).size === 0) {
          classRooms.delete(user.classId);
        }
      }
      
      // Remove from active users
      activeUsers.delete(socket.id);
    } else {
      console.log(`User disconnected: ${socket.id}`);
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Make io accessible to routes
app.set('io', io);

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://learnova-one.vercel.app',
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  return res.sendStatus(204);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(helmet({ crossOriginOpenerPolicy: false }));

app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET || 'fallback-secret-key'
}));

require("./config/passport");
app.use(passport.initialize());
app.use(passport.session());

app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads')));

const authRoutes = require('./routes/auth');
const userRoutes = require("./routes/userroutes");
const classRoutes = require('./routes/classroutes');
const assignmentRoutes = require('./routes/assignmentroutes');

app.use('/api/auth', authRoutes);
app.use("/user", userRoutes);
app.use('/api/class', classRoutes);
app.use('/api/assign', assignmentRoutes);

app.get('/', (req, res) => {
  res.json({ 
    message: 'API is running successfully!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    activeConnections: activeUsers.size,
    activeClasses: classRooms.size
  });
});

// API endpoint to get active users in a class 
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

app.use((err, req, res, next) => {
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      success: false,
      message: 'CORS Error: Origin not allowed',
      origin: req.get('origin'),
      allowedOrigins: allowedOrigins
    });
  }
  next(err);
});

app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    method: req.method
  });
});

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected successfully');

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => { 
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Allowed CORS origins:`, allowedOrigins);
      console.log(`Static files served from: ${path.join(__dirname, 'uploads')}`);
      console.log(`Socket.IO enabled for real-time communication`);
    });
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
})();

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  io.close(() => {
    console.log('Socket.IO closed.');
    mongoose.connection.close(() => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  io.close(() => {
    console.log('Socket.IO closed.');
    mongoose.connection.close(() => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    });
  });
});