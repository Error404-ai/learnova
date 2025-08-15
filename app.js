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
const crypto = require('crypto');

// Import organized handlers
const { socketAuth, handleConnection, startCleanupInterval } = require('./socket/socketHandler');
const { setupVideoCallHandlers, initializeMediaSoup } = require('./socket/videoCallHandler');
const { setupMeetingHandlers } = require('./socket/meetingSocketHandler');

dotenv.config();

const app = express();
app.get('/api/ice-servers', (req, res) => {
  try {
    const iceServers = [];
    
    // Always include public STUN servers
    iceServers.push(
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    );
    
    // Add your TURN server if configured
    const TURN_SERVER_URL = process.env.TURN_SERVER_URL;
    const TURN_USERNAME = process.env.TURN_USERNAME;
    const TURN_PASSWORD = process.env.TURN_PASSWORD;
    
    if (TURN_SERVER_URL && TURN_USERNAME && TURN_PASSWORD) {
      iceServers.push(
        {
          urls: TURN_SERVER_URL,
          username: TURN_USERNAME,
          credential: TURN_PASSWORD
        },
        {
          urls: TURN_SERVER_URL.replace('turn:', 'turns:').replace(':3478', ':5349'),
          username: TURN_USERNAME,
          credential: TURN_PASSWORD
        }
      );
    }

    res.json({
      iceServers,
      success: true
    });
  } catch (error) {
    console.error('Error providing ICE servers:', error);
    res.status(500).json({
      error: 'Failed to get ICE servers',
      iceServers: [
        // Fallback to public STUN only
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });
  }
});
const server = http.createServer(app);

// Models
const Message = require('./models/classMessage');

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'https://learnov.netlify.app',
      'http://127.0.0.1:3000',
      'https://learnova-one.vercel.app'
    ],
    credentials: true,
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  allowEIO3: true
});

// Apply socket middleware and handlers
io.use(socketAuth);

// Setup all socket handlers
io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.userName} (${socket.userRole}) - Socket ID: ${socket.id}`);
  
  // Setup different handler groups
  const mainHandler = handleConnection(io);
  mainHandler(socket);
  
  setupVideoCallHandlers(socket, io);
  setupMeetingHandlers(socket, io);
  
  // Handle connection errors
  socket.on('connect_error', (error) => {
    console.error(`❌ Connection error for ${socket.userName}:`, error.message);
  });

  socket.on('disconnecting', () => {
    console.log(`⚠️ User disconnecting: ${socket.userName} - Socket ID: ${socket.id}`);
  });
});

// Start cleanup intervals
startCleanupInterval();

// Make io available to other parts of the app
app.set('io', io);

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://learnov.netlify.app',
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
      "https://project2-zphf.onrender.com",
      'http://13.51.207.176:5000'
    ],
  },
}));

app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
}));

// Passport configuration
require("./config/passport");
app.use(passport.initialize());
app.use(passport.session());

// Static files
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
const turnRoutes = require('./routes/turn')
try {
  const turnRoutes = require('./routes/turn');
  console.log("✅ TURN routes loaded successfully");
  
  app.use("/api", turnRoutes);
  console.log("✅ TURN routes mounted on /api");
} catch (error) {
  console.error("❌ Failed to load TURN routes:", error.message);
}

app.use("/api", turnRoutes);
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
  const { classRooms, activeUsers } = require('./socket/socketHandler');
  
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
  const { activeUsers, classRooms } = require('./socket/socketHandler');
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
    // Initialize MediaSoup first
    await initializeMediaSoup();

    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, '0.0.0.0',() => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebRTC SFU ready for video calls`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
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
// Add this to your app.js for debugging

app.get('/api/debug/video-status', (req, res) => {
  const { videoPeers, peerTransports, peerProducers, peerConsumers } = require('./socket/videoCallHandler');
  
  res.json({
    mediasoupWorker: !!mediasoupWorker,
    activePeers: videoPeers.size,
    activeTransports: peerTransports.size,
    activeProducers: peerProducers.size,
    activeConsumers: peerConsumers.size,
    serverIP: process.env.ANNOUNCED_IP || 'NOT_SET',
    environment: process.env.NODE_ENV,
    peers: Array.from(videoPeers.values()).map(p => ({
      socketId: p.socketId,
      userName: p.userName,
      classId: p.classId
    }))
  });
});

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);