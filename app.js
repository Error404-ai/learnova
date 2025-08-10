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

const mediasoup = require('mediasoup'); //For WebRTC

dotenv.config();

const app = express();
const server = http.createServer(app);

const Message = require('./models/classMessage');
const User = require('./models/User');

// Socket.IO configuration with better error handling
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
  // Add connection state recovery
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
  // Add adapter options for better reliability
  allowEIO3: true
});

// In-memory stores
const activeUsers = new Map();
const classRooms = new Map();
const messageRateLimits = new Map();

// SFU NEW VARIABLES
const mediaConfig = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'debug', // Change to debug to see more info
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: process.env.NODE_ENV === 'production' 
          ? (process.env.ANNOUNCED_IP || 'your-server-ip')
          : '127.0.0.1',
      },
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    enableSctp: false, // Disable SCTP for now
    // Add additional options for better connectivity
    iceConsentTimeout: 30,
    enableIceRestart: true
  },
};
let mediasoupWorker;
const classRouters = new Map();
const peerTransports = new Map();
const peerProducers = new Map();
const peerConsumers = new Map();
const videoPeers = new Map();

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

const broadcastActiveUsers = (classId) => {
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

//MediaSoup Functions 
async function initializeMediaSoup() {
  try {
    if (mediasoupWorker) {
      console.log('⚠️ MediaSoup worker already initialized');
      return mediasoupWorker;
    }

    console.log('🔧 Creating MediaSoup worker with config:', {
      logLevel: mediaConfig.worker.logLevel,
      rtcMinPort: mediaConfig.worker.rtcMinPort,
      rtcMaxPort: mediaConfig.worker.rtcMaxPort,
    });

    mediasoupWorker = await mediasoup.createWorker({
      logLevel: mediaConfig.worker.logLevel,
      rtcMinPort: mediaConfig.worker.rtcMinPort,
      rtcMaxPort: mediaConfig.worker.rtcMaxPort,
    });

    console.log('✅ MediaSoup worker created with PID:', mediasoupWorker.pid);

    mediasoupWorker.on('died', (error) => {
      console.error('❌ MediaSoup worker died:', error);
      mediasoupWorker = null;
      
      // Notify all connected video call users
      io.emit('server_error', {
        type: 'MEDIASOUP_WORKER_DIED',
        message: 'Video call service temporarily unavailable'
      });
      
      setTimeout(() => {
        console.log('🔄 Attempting to restart MediaSoup worker...');
        initializeMediaSoup().catch(console.error);
      }, 2000);
    });

    // Log worker resource usage periodically
    setInterval(async () => {
      try {
        const usage = await mediasoupWorker.getResourceUsage();
        console.log('📊 MediaSoup worker usage:', usage);
      } catch (err) {
        console.log('Could not get worker usage');
      }
    }, 60000); // Every minute

    return mediasoupWorker;
  } catch (error) {
    console.error('❌ Failed to create MediaSoup worker:', error);
    mediasoupWorker = null;
    throw error;
  }
}
async function getClassRouter(classId) {
  try {
    if (!classRouters.has(classId)) {
      if (!mediasoupWorker) {
        await initializeMediaSoup();
      }
      const router = await mediasoupWorker.createRouter({
        mediaCodecs: mediaConfig.router.mediaCodecs,
      });
      classRouters.set(classId, router);
      console.log(`🔧 Router created for class ${classId}`);
    }
    return classRouters.get(classId);
  } catch (error) {
    console.error('❌ Error creating router for class:', classId, error);
    throw error;
  }
}

async function createConsumersForExistingPeers(newPeerSocketId, classId, newProducer, kind, io) {
  try {
    const classPeers = Array.from(videoPeers.values())
      .filter(p => p.classId === classId && p.socketId !== newPeerSocketId);

    console.log(`📡 Creating consumers for ${classPeers.length} existing peers`);

    for (const existingPeer of classPeers) {
      const existingSocket = io.sockets.sockets.get(existingPeer.socketId);
      if (!existingSocket || !existingSocket.connected) continue;

      existingSocket.emit('new_producer_available', {
        producerId: newProducer.id,
        kind: newProducer.kind,
        producerSocketId: newPeerSocketId,
        producerName: videoPeers.get(newPeerSocketId)?.userName,
      });
    }

    const newPeerSocket = io.sockets.sockets.get(newPeerSocketId);
    if (newPeerSocket && newPeerSocket.connected) {
      for (const existingPeer of classPeers) {
        const existingProducers = peerProducers.get(existingPeer.socketId);
        if (existingProducers) {
          Object.entries(existingProducers).forEach(([producerKind, producer]) => {
            if (producer && !producer.closed) {
              newPeerSocket.emit('new_producer_available', {
                producerId: producer.id,
                kind: producer.kind,
                producerSocketId: existingPeer.socketId,
                producerName: existingPeer.userName,
              });
            }
          });
        }
      }
    }
  } catch (error) {
    console.error('❌ Error creating consumers for existing peers:', error);
  }
}

async function cleanupVideoCallResources(socketId) {
  try {
    console.log(`🧹 Starting cleanup for socket ${socketId}`);
    
    // Close producers
    const producers = peerProducers.get(socketId);
    if (producers) {
      Object.values(producers).forEach(producer => {
        try {
          if (producer && !producer.closed) {
            producer.close();
          }
        } catch (error) {
          console.error('Error closing producer:', error);
        }
      });
      peerProducers.delete(socketId);
    }

    // Close consumers
    const consumers = peerConsumers.get(socketId) || [];
    consumers.forEach(consumer => {
      try {
        if (consumer && !consumer.closed) {
          consumer.close();
        }
      } catch (error) {
        console.error('Error closing consumer:', error);
      }
    });
    peerConsumers.delete(socketId);

    // Close transports
    const transports = peerTransports.get(socketId);
    if (transports) {
      try {
        if (transports.sendTransport && !transports.sendTransport.closed) {
          transports.sendTransport.close();
        }
        if (transports.recvTransport && !transports.recvTransport.closed) {
          transports.recvTransport.close();
        }
      } catch (error) {
        console.error('Error closing transports:', error);
      }
      peerTransports.delete(socketId);
    }

    // Remove from video peers
    const peer = videoPeers.get(socketId);
    videoPeers.delete(socketId);

    // Notify other peers
    if (peer && peer.classId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.to(`class_${peer.classId}`).emit('user_left_video', {
          userId: peer.userId,
          userName: peer.userName,
          socketId: socketId
        });
      }
    }

    console.log(`✅ Cleaned up video call resources for socket ${socketId}`);
  } catch (error) {
    console.error('❌ Error cleaning up video call resources:', error);
  }
}

// Enhanced Socket.IO middleware with better error handling
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    
    if (!token) {
      console.log('❌ No authentication token provided');
      return next(new Error('Authentication token required'));
    }
    
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace(/^Bearer\s+/i, '');
    
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id || decoded.userId).select('_id name role email');
    
    if (!user) {
      console.log('❌ User not found for token');
      return next(new Error('User not found'));
    }
    
    // Attach user data to socket
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
});

// Socket.IO connection handling with enhanced error handling
io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.userName} (${socket.userRole}) - Socket ID: ${socket.id}`);
  
  // Handle connection errors
  socket.on('connect_error', (error) => {
    console.error(`❌ Connection error for ${socket.userName}:`, error.message);
  });

  // Handle disconnecting event
  socket.on('disconnecting', () => {
    console.log(`⚠️ User disconnecting: ${socket.userName} - Socket ID: ${socket.id}`);
  });
  
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
      
      // Send confirmation to user
      socket.emit('class_joined', {
        success: true,
        classId,
        message: `Successfully joined class ${classId}`
      });
      
      // Broadcast updates
      broadcastActiveUsers(classId);
      await sendClassMessages(socket, classId);
      
      console.log(`✅ User ${socket.userName} joined class ${classId} as ${socket.userRole}`);
    } catch (error) {
      console.error('❌ Error in joinClass:', error);
      sendError(socket, 'Failed to join class', 'SERVER_ERROR');
    }
  });

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

  // Meeting handlers with better error handling
  const handleMeetingEvent = (eventType, data) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user?.classId) {
        sendError(socket, 'You must join a class first', 'CLASS_ERROR');
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
      sendError(socket, 'Failed to process meeting event', 'SERVER_ERROR');
    }
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

  // Enhanced video call handlers
  socket.on('join_video_call', async (data) => {
  try {
    // Get user from socket or data
    let user = activeUsers.get(socket.id);
    
    // If user not in activeUsers, try to get from data or re-authenticate
    if (!user && data.classId) {
      console.log(`⚠️ User not in activeUsers, attempting to rejoin class ${data.classId}`);
      
      // Re-add user to activeUsers
      user = {
        userId: socket.userId,
        userName: socket.userName,
        classId: data.classId,
        userRole: socket.userRole,
        joinedAt: new Date()
      };
      
      activeUsers.set(socket.id, user);
      
      // Re-join the class room
      socket.join(`class_${data.classId}`);
      
      // Update class rooms
      if (!classRooms.has(data.classId)) {
        classRooms.set(data.classId, new Set());
      }
      classRooms.get(data.classId).add(socket.id);
      
      console.log(`🔄 Re-joined class ${data.classId} for video call`);
    }
    
    if (!user?.classId) {
      console.log(`❌ No class context for user ${socket.userName}`, {
        hasUser: !!user,
        classId: user?.classId,
        dataClassId: data?.classId,
        socketRooms: Array.from(socket.rooms)
      });
      return sendError(socket, 'You must join a class first', 'CLASS_ERROR');
    }

    console.log(`🎥 ${user.userName} (${user.userRole}) joining video call for class ${user.classId}`);

    // Initialize MediaSoup worker if not already done
    if (!mediasoupWorker) {
      console.log('⚠️ MediaSoup worker not initialized, initializing now...');
      await initializeMediaSoup();
    }

    const router = await getClassRouter(user.classId);
    
    // Store peer information
    videoPeers.set(socket.id, {
      socketId: socket.id,
      classId: user.classId,
      userId: user.userId,
      userName: user.userName,
      userRole: user.userRole,
      rtpCapabilities: null,
    });

    // Initialize empty consumers array
    peerConsumers.set(socket.id, []);

    // Send RTP capabilities to client
    socket.emit('video_call_ready', {
      rtpCapabilities: router.rtpCapabilities,
      success: true,
      classId: user.classId,
      userRole: user.userRole
    });

    console.log(`✅ Video call ready for ${user.userName}`);

    // Broadcast to other users in the class that someone joined
    socket.to(`class_${user.classId}`).emit('user_joined_video', {
      userId: user.userId,
      userName: user.userName,
      socketId: socket.id,
      userRole: user.userRole
    });

  } catch (error) {
    console.error('❌ Error joining video call:', error);
    sendError(socket, `Failed to join video call: ${error.message}`, 'VIDEO_CALL_ERROR');
  }
});
  socket.on('set_rtp_capabilities', async (data) => {
  try {
    const peer = videoPeers.get(socket.id);
    if (!peer) {
      return sendError(socket, 'Peer not found', 'VIDEO_CALL_ERROR');
    }

    peer.rtpCapabilities = data.rtpCapabilities;
    videoPeers.set(socket.id, peer);

    const router = await getClassRouter(peer.classId);

    // Create transports with enhanced configuration
    const transportOptions = {
      ...mediaConfig.webRtcTransport,
      appData: { 
        socketId: socket.id, 
        userId: peer.userId,
        userName: peer.userName 
      }
    };

    const sendTransport = await router.createWebRtcTransport(transportOptions);
    const recvTransport = await router.createWebRtcTransport(transportOptions);

    // Enhanced transport event handlers
    sendTransport.on('dtlsstatechange', (dtlsState) => {
      console.log(`📡 Send transport DTLS state: ${dtlsState} for ${peer.userName}`);
      if (dtlsState === 'failed') {
        console.log(`❌ Send transport DTLS failed for ${peer.userName}`);
        socket.emit('transport_error', {
          transportId: sendTransport.id,
          direction: 'send',
          error: 'DTLS connection failed'
        });
      } else if (dtlsState === 'connected') {
        console.log(`✅ Send transport DTLS connected for ${peer.userName}`);
      }
    });

    recvTransport.on('dtlsstatechange', (dtlsState) => {
      console.log(`📡 Recv transport DTLS state: ${dtlsState} for ${peer.userName}`);
      if (dtlsState === 'failed') {
        console.log(`❌ Recv transport DTLS failed for ${peer.userName}`);
        socket.emit('transport_error', {
          transportId: recvTransport.id,
          direction: 'recv',
          error: 'DTLS connection failed'
        });
      } else if (dtlsState === 'connected') {
        console.log(`✅ Recv transport DTLS connected for ${peer.userName}`);
      }
    });

    // Add ICE state change handlers
    sendTransport.on('icestatechange', (iceState) => {
      console.log(`🧊 Send transport ICE state: ${iceState} for ${peer.userName}`);
      if (iceState === 'failed') {
        socket.emit('transport_error', {
          transportId: sendTransport.id,
          direction: 'send',
          error: 'ICE connection failed'
        });
      }
    });

    recvTransport.on('icestatechange', (iceState) => {
      console.log(`🧊 Recv transport ICE state: ${iceState} for ${peer.userName}`);
      if (iceState === 'failed') {
        socket.emit('transport_error', {
          transportId: recvTransport.id,
          direction: 'recv',
          error: 'ICE connection failed'
        });
      }
    });

    // Connection state handlers
    sendTransport.on('connectionstatechange', (state) => {
      console.log(`🔗 Send transport connection state: ${state} for ${peer.userName}`);
      socket.emit('transport_connection_state', {
        transportId: sendTransport.id,
        direction: 'send',
        state
      });
    });

    recvTransport.on('connectionstatechange', (state) => {
      console.log(`🔗 Recv transport connection state: ${state} for ${peer.userName}`);
      socket.emit('transport_connection_state', {
        transportId: recvTransport.id,
        direction: 'recv',
        state
      });
    });

    peerTransports.set(socket.id, {
      sendTransport,
      recvTransport,
    });

    socket.emit('transports_created', {
      sendTransport: {
        id: sendTransport.id,
        iceParameters: sendTransport.iceParameters,
        iceCandidates: sendTransport.iceCandidates,
        dtlsParameters: sendTransport.dtlsParameters,
        sctpParameters: sendTransport.sctpParameters,
      },
      recvTransport: {
        id: recvTransport.id,
        iceParameters: recvTransport.iceParameters,
        iceCandidates: recvTransport.iceCandidates,
        dtlsParameters: recvTransport.dtlsParameters,
        sctpParameters: recvTransport.sctpParameters,
      },
      success: true
    });

    console.log(`🚛 Transports created for ${peer.userName}`);

  } catch (error) {
    console.error('❌ Error creating transports:', error);
    sendError(socket, `Failed to create transports: ${error.message}`, 'VIDEO_CALL_ERROR');
  }
});
socket.on('connect_transport', async (data) => {
  try {
    const { transportId, dtlsParameters, direction } = data;
    const transports = peerTransports.get(socket.id);
    const peer = videoPeers.get(socket.id);
    
    console.log(`🔧 Connecting ${direction} transport for ${peer?.userName}`, {
      transportId,
      dtlsRole: dtlsParameters.role,
      fingerprintsCount: dtlsParameters.fingerprints?.length
    });
    
    if (!transports) {
      return sendError(socket, 'Transports not found. Please rejoin the video call.', 'VIDEO_CALL_ERROR');
    }

    const transport = direction === 'send' ? transports.sendTransport : transports.recvTransport;
    
    if (!transport || transport.id !== transportId) {
      console.log(`❌ Transport mismatch: expected ${transportId}, got ${transport?.id}`);
      return sendError(socket, 'Transport ID mismatch', 'VIDEO_CALL_ERROR');
    }

    // Check if transport is already connected
    if (transport.connectionState === 'connected') {
      console.log(`⚠️ Transport already connected: ${direction} for ${peer?.userName}`);
      return socket.emit('transport_connected', { 
        transportId, 
        direction,
        success: true,
        alreadyConnected: true
      });
    }

    // Add connection timeout with proper cleanup
    const connectTimeout = setTimeout(() => {
      console.log(`⏰ Transport connection timeout for ${direction} transport of ${peer?.userName}`);
      socket.emit('transport_connected', { 
        transportId, 
        direction,
        success: false,
        error: 'Connection timeout - please check your network connection'
      });
    }, 15000); // Increased to 15 seconds

    console.log(`🚀 Attempting to connect ${direction} transport...`);
    
    await transport.connect({ dtlsParameters });
    clearTimeout(connectTimeout);
    
    console.log(`✅ Transport connected successfully: ${direction} for ${peer?.userName}`);
    
    socket.emit('transport_connected', { 
      transportId, 
      direction,
      success: true,
      connectionState: transport.connectionState
    });

  } catch (error) {
    console.error(`❌ Error connecting ${data.direction} transport:`, {
      error: error.message,
      stack: error.stack,
      transportId: data.transportId,
      user: videoPeers.get(socket.id)?.userName
    });
    
    socket.emit('transport_connected', { 
      transportId: data.transportId, 
      direction: data.direction,
      success: false,
      error: error.message,
      code: error.code || 'TRANSPORT_CONNECTION_FAILED'
    });
  }
});

socket.on('retry_transport_connection', async (data) => {
  try {
    const { transportId, direction } = data;
    const peer = videoPeers.get(socket.id);
    
    if (!peer) {
      return sendError(socket, 'Peer not found', 'VIDEO_CALL_ERROR');
    }

    console.log(`🔄 Retrying transport connection: ${direction} for ${peer.userName}`);

    // Clean up existing transport
    const existingTransports = peerTransports.get(socket.id);
    if (existingTransports) {
      const transport = direction === 'send' ? existingTransports.sendTransport : existingTransports.recvTransport;
      if (transport) {
        try {
          transport.close();
        } catch (err) {
          console.log('Transport already closed');
        }
      }
    }

    // Create new transport
    const router = await getClassRouter(peer.classId);
    const transportOptions = {
      ...mediaConfig.webRtcTransport,
      appData: { 
        socketId: socket.id, 
        userId: peer.userId,
        userName: peer.userName,
        retry: true
      }
    };

    const newTransport = await router.createWebRtcTransport(transportOptions);

    // Update transport in storage
    if (direction === 'send') {
      existingTransports.sendTransport = newTransport;
    } else {
      existingTransports.recvTransport = newTransport;
    }

    socket.emit('transport_recreated', {
      direction,
      transport: {
        id: newTransport.id,
        iceParameters: newTransport.iceParameters,
        iceCandidates: newTransport.iceCandidates,
        dtlsParameters: newTransport.dtlsParameters,
        sctpParameters: newTransport.sctpParameters,
      },
      success: true
    });

  } catch (error) {
    console.error('❌ Error retrying transport connection:', error);
    sendError(socket, 'Failed to retry transport connection', 'VIDEO_CALL_ERROR');
  }
});

  socket.on('start_producing', async (data) => {
    try {
      const { kind, rtpParameters } = data;
      const peer = videoPeers.get(socket.id);
      const transports = peerTransports.get(socket.id);
      
      if (!peer || !transports) {
        return sendError(socket, 'Peer or transport not found', 'VIDEO_CALL_ERROR');
      }

      const producer = await transports.sendTransport.produce({
        kind,
        rtpParameters,
      });

      // Handle producer events
      producer.on('transportclose', () => {
        console.log(`Producer transport closed: ${kind} for ${peer.userName}`);
      });

      producer.on('@close', () => {
        console.log(`Producer closed: ${kind} for ${peer.userName}`);
      });

      if (!peerProducers.has(socket.id)) {
        peerProducers.set(socket.id, {});
      }
      const producers = peerProducers.get(socket.id);
      producers[kind] = producer;

      socket.emit('producer_created', {
        kind,
        producerId: producer.id,
        success: true
      });

      console.log(`🎬 Producer created: ${kind} for ${peer.userName}`);

      // Notify other peers about the new producer
      await createConsumersForExistingPeers(socket.id, peer.classId, producer, kind, io);

    } catch (error) {
      console.error('❌ Error creating producer:', error);
      sendError(socket, 'Failed to create producer', 'VIDEO_CALL_ERROR');
    }
  });

  socket.on('start_consuming', async (data) => {
    try {
      const { producerId } = data;
      const peer = videoPeers.get(socket.id);
      const transports = peerTransports.get(socket.id);
      
      if (!peer || !transports) {
        return sendError(socket, 'Peer or transport not found', 'VIDEO_CALL_ERROR');
      }

      const router = await getClassRouter(peer.classId);

      if (!router.canConsume({
        producerId,
        rtpCapabilities: peer.rtpCapabilities,
      })) {
        return sendError(socket, 'Cannot consume this producer', 'VIDEO_CALL_ERROR');
      }

      const consumer = await transports.recvTransport.consume({
        producerId,
        rtpCapabilities: peer.rtpCapabilities,
        paused: true,
      });

      // Handle consumer events
      consumer.on('transportclose', () => {
        console.log(`Consumer transport closed for ${peer.userName}`);
      });

      consumer.on('producerclose', () => {
        console.log(`Producer closed, removing consumer for ${peer.userName}`);
        const consumers = peerConsumers.get(socket.id) || [];
        const index = consumers.findIndex(c => c.id === consumer.id);
        if (index !== -1) {
          consumers.splice(index, 1);
          peerConsumers.set(socket.id, consumers);
        }
        
        // Notify client about producer closure
        socket.emit('producer_closed', {
          consumerId: consumer.id,
          producerId
        });
      });

      const consumers = peerConsumers.get(socket.id) || [];
      consumers.push(consumer);
      peerConsumers.set(socket.id, consumers);

      socket.emit('consumer_created', {
        consumerId: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        success: true
      });

      console.log(`🍿 Consumer created: ${consumer.kind} for ${peer.userName}`);

    } catch (error) {
      console.error('❌ Error creating consumer:', error);
      sendError(socket, 'Failed to create consumer', 'VIDEO_CALL_ERROR');
    }
  });

socket.on('resume_consumer', async (data) => {
  try {
    const { consumerId } = data;
    const consumers = peerConsumers.get(socket.id) || [];
    const consumer = consumers.find(c => c.id === consumerId);
    
    if (!consumer) {
      return sendError(socket, 'Consumer not found', 'VIDEO_CALL_ERROR');
    }

    await consumer.resume();
    
    socket.emit('consumer_resumed', { 
      consumerId,
      success: true 
    });
    
    console.log(`▶️ Consumer resumed: ${consumerId}`);

  } catch (error) {
    console.error('❌ Error resuming consumer:', error);
    socket.emit('consumer_resumed', { 
      consumerId: data.consumerId,
      success: false,
      error: error.message 
    });
  }
});
socket.on('leave_video_call', async () => {
  await cleanupVideoCallResources(socket.id);
  socket.emit('video_call_left');
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

  socket.on('disconnect', async () => {
  console.log(`User disconnected: ${socket.userName} - Socket ID: ${socket.id}`);
 
  await cleanupVideoCallResources(socket.id);
  
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
    // Initialize MediaSoup first
    await initializeMediaSoup();

    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
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

