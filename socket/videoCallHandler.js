const mediasoup = require('mediasoup');

// Media configuration
const mediaConfig = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
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
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
        },
      },
    ],
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: process.env.NODE_ENV === 'production'
          ? (process.env.ANNOUNCED_IP)
          : '127.0.0.1',
      },
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    enableSctp: false,
    iceConsentTimeout: 20,
    enableIceRestart: true,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
  },
};

// MediaSoup instances
let mediasoupWorker;
const classRouters = new Map();
const peerTransports = new Map();
const peerProducers = new Map();
const peerConsumers = new Map();
const videoPeers = new Map();

// Initialize MediaSoup worker
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

      setTimeout(() => {
        console.log('🔄 Attempting to restart MediaSoup worker...');
        initializeMediaSoup().catch(console.error);
      }, 2000);
    });

    return mediasoupWorker;
  } catch (error) {
    console.error('❌ Failed to create MediaSoup worker:', error);
    mediasoupWorker = null;
    throw error;
  }
}

// Get or create router for class
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

/**
 * Informs all other peers in the class about a new producer.
 * This is called when a new peer starts producing their stream.
 * The other peers will then request to consume this new producer.
 */
async function informExistingPeersOfNewProducer(newPeerSocketId, classId, newProducer, io) {
  try {
    const classPeers = Array.from(videoPeers.values())
      .filter(p => p.classId === classId && p.socketId !== newPeerSocketId);

    console.log(`📡 Informing ${classPeers.length} existing peers of new producer`);

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
  } catch (error) {
    console.error('❌ Error informing existing peers of new producer:', error);
  }
}

/**
 * Informs a newly joined peer about all producers already active in the class.
 * This is called when a peer first joins the video call.
 * The new peer will then request to consume these producers.
 */
function informNewPeerOfExistingProducers(newPeerSocketId, classId, io) {
  try {
    const producers = [];
    for (const [socketId, peer] of videoPeers.entries()) {
      if (peer.classId === classId && socketId !== newPeerSocketId) {
        const userProducers = peerProducers.get(socketId);
        if (userProducers) {
          for (const producer of Object.values(userProducers)) {
            if (producer && !producer.closed) {
              producers.push({
                producerId: producer.id,
                kind: producer.kind,
                producerSocketId: socketId,
                producerName: peer.userName,
              });
            }
          }
        }
      }
    }
    
    console.log(`📡 Sending ${producers.length} existing producers to new peer ${newPeerSocketId}`);

    const newPeerSocket = io.sockets.sockets.get(newPeerSocketId);
    if (newPeerSocket && newPeerSocket.connected) {
      newPeerSocket.emit('existing_producers', producers);
    }
  } catch (error) {
    console.error('❌ Error informing new peer of existing producers:', error);
  }
}

// Clean up video call resources
async function cleanupVideoCallResources(socketId, io) {
  try {
    console.log(`🧹 Starting cleanup for socket ${socketId}`);

    // Notify other peers about a producer being closed
    const peer = videoPeers.get(socketId);
    if (peer && peer.classId && io) {
      const producersToClose = peerProducers.get(socketId);
      if (producersToClose) {
        for (const producer of Object.values(producersToClose)) {
          io.to(`class_${peer.classId}`).emit('producer_closed', { producerId: producer.id });
        }
      }
    }
    
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
    videoPeers.delete(socketId);

    // Notify other peers of user leaving
    if (peer && peer.classId && io) {
      io.to(`class_${peer.classId}`).emit('user_left_video', {
        userId: peer.userId,
        userName: peer.userName,
        socketId: socketId
      });
    }

    console.log(`✅ Cleaned up video call resources for socket ${socketId}`);
  } catch (error) {
    console.error('❌ Error cleaning up video call resources:', error);
  }
}

// Video call socket handlers
const setupVideoCallHandlers = (socket, io) => {
  const sendError = (message, code = 'VIDEO_CALL_ERROR') => {
    if (socket && socket.connected) {
      socket.emit('error', {
        message,
        code,
        timestamp: new Date().toISOString()
      });
    }
  };

  const { activeUsers } = require('./socketHandler');

  // Join video call
  socket.on('join_video_call', async (data) => {
    try {
      let user = activeUsers.get(socket.id);

      if (!user && data.classId) {
        console.log(`⚠️ User not in activeUsers, attempting to rejoin class ${data.classId}`);

        user = {
          userId: socket.userId,
          userName: socket.userName,
          classId: data.classId,
          userRole: socket.userRole,
          joinedAt: new Date()
        };

        activeUsers.set(socket.id, user);
        socket.join(`class_${data.classId}`);
        console.log(`🔄 Re-joined class ${data.classId} for video call`);
      }

      if (!user?.classId) {
        return sendError('You must join a class first', 'CLASS_ERROR');
      }

      console.log(`🎥 ${user.userName} (${user.userRole}) joining video call for class ${user.classId}`);

      if (!mediasoupWorker) {
        await initializeMediaSoup();
      }

      const router = await getClassRouter(user.classId);

      // New peer is added to videoPeers map
      videoPeers.set(socket.id, {
        socketId: socket.id,
        classId: user.classId,
        userId: user.userId,
        userName: user.userName,
        userRole: user.userRole,
        rtpCapabilities: null,
      });

      peerConsumers.set(socket.id, []);

      // NEW LOGIC: Inform the newly joined peer about all existing producers
      informNewPeerOfExistingProducers(socket.id, user.classId, io);
      
      socket.emit('video_call_ready', {
        rtpCapabilities: router.rtpCapabilities,
        success: true,
        classId: user.classId,
        userRole: user.userRole
      });

      socket.to(`class_${user.classId}`).emit('user_joined_video', {
        userId: user.userId,
        userName: user.userName,
        socketId: socket.id,
        userRole: user.userRole
      });

    } catch (error) {
      console.error('❌ Error joining video call:', error);
      sendError(`Failed to join video call: ${error.message}`);
    }
  });

  // Set RTP capabilities and create transports
  socket.on('set_rtp_capabilities', async (data) => {
    try {
      const peer = videoPeers.get(socket.id);
      if (!peer) {
        return sendError('Peer not found');
      }

      peer.rtpCapabilities = data.rtpCapabilities;
      videoPeers.set(socket.id, peer);

      const router = await getClassRouter(peer.classId);
      const transportOptions = {
        ...mediaConfig.webRtcTransport,
        appData: {
          socketId: socket.id,
          userId: peer.userId,
          userName: peer.userName
        },
      };

      const sendTransport = await router.createWebRtcTransport(transportOptions);
      const recvTransport = await router.createWebRtcTransport(transportOptions);

      // Set up transport handlers
      const setupTransportHandlers = (transport, direction) => {
        transport.on('dtlsstatechange', (dtlsState) => {
          console.log(`📡 ${direction} transport DTLS: ${dtlsState} for ${peer.userName}`);
          socket.emit('transport_dtls_state', {
            transportId: transport.id,
            direction,
            state: dtlsState
          });
        });

        transport.on('icestatechange', (iceState) => {
          console.log(`🧊 ${direction} transport ICE: ${iceState} for ${peer.userName}`);
          socket.emit('transport_ice_state', {
            transportId: transport.id,
            direction,
            state: iceState
          });
        });
      };

      setupTransportHandlers(sendTransport, 'Send');
      setupTransportHandlers(recvTransport, 'Recv');

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

      console.log(`🚛 Enhanced transports created for ${peer.userName}`);

    } catch (error) {
      console.error('❌ Error creating transports:', error);
      sendError(`Failed to create transports: ${error.message}`);
    }
  });

  // Connect transport
  socket.on('connect_transport', async (data) => {
    try {
      const { transportId, dtlsParameters, direction } = data;
      const transports = peerTransports.get(socket.id);
      const peer = videoPeers.get(socket.id);

      if (!transports) {
        return sendError('Transports not found. Please rejoin the video call.');
      }

      const transport = direction === 'send' ? transports.sendTransport : transports.recvTransport;

      if (!transport || transport.id !== transportId) {
        return sendError('Transport ID mismatch');
      }

      console.log(`🔧 Connecting ${direction} transport for ${peer?.userName}`);

      if (transport.connectionState === 'connected' && transport.dtlsState === 'connected') {
        return socket.emit('transport_connected', {
          transportId,
          direction,
          success: true,
          alreadyConnected: true
        });
      }

      await transport.connect({ dtlsParameters });

      socket.emit('transport_connected', {
        transportId,
        direction,
        success: true,
        connectionState: transport.connectionState,
        dtlsState: transport.dtlsState,
        iceState: transport.iceState
      });

      console.log(`✅ Transport connected: ${direction} for ${peer?.userName}`);

    } catch (error) {
      console.error(`❌ Error connecting ${data.direction} transport:`, error);
      socket.emit('transport_connected', {
        transportId: data.transportId,
        direction: data.direction,
        success: false,
        error: error.message
      });
    }
  });

  // Start producing
  socket.on('start_producing', async (data) => {
    try {
      const { kind, rtpParameters } = data;
      const peer = videoPeers.get(socket.id);
      const transports = peerTransports.get(socket.id);

      if (!peer || !transports) {
        return sendError('Peer or transport not found');
      }

      const producer = await transports.sendTransport.produce({
        kind,
        rtpParameters,
      });

      producer.on('transportclose', () => {
        console.log(`Producer transport closed: ${kind} for ${peer.userName}`);
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

      // OLD LOGIC: inform all other peers of the new producer
      informExistingPeersOfNewProducer(socket.id, peer.classId, producer, io);

    } catch (error) {
      console.error('❌ Error creating producer:', error);
      sendError('Failed to create producer');
    }
  });

  // Get existing producers (This is now redundant on the server side, as the server
  // sends this information proactively. You might need this for client-side
  // a-la-carte consumption, but the initial bug is fixed without it).
  socket.on('get_existing_producers', ({ classId }) => {
    // You can remove this event handler if you fully rely on the proactive
    // `informNewPeerOfExistingProducers` call in `join_video_call`.
    // The current code is fine, it just means you have two ways to do the same thing.
    informNewPeerOfExistingProducers(socket.id, classId, io);
  });

  // Start consuming
  socket.on('start_consuming', async (data) => {
    try {
      const { producerId, consumerRtpCapabilities } = data;
      const peer = videoPeers.get(socket.id);
      const transports = peerTransports.get(socket.id);

      if (!peer || !transports) {
        return sendError('Peer or transport not found');
      }

      const recvTransport = transports.recvTransport;
      if (!recvTransport || recvTransport.closed) {
        return socket.emit('consumer_creation_failed', {
          producerId,
          reason: 'Receive transport not available'
        });
      }

      const router = await getClassRouter(peer.classId);

      // Find the producer to consume
      let producerToConsume;
      for (const [socketId, producers] of peerProducers.entries()) {
          for (const kind in producers) {
              if (producers[kind].id === producerId) {
                  producerToConsume = producers[kind];
                  break;
              }
          }
          if (producerToConsume) break;
      }

      if (!producerToConsume) {
          return sendError('Producer not found');
      }

      const canConsume = router.canConsume({
          producerId: producerToConsume.id,
          rtpCapabilities: peer.rtpCapabilities
      });

      if (!canConsume) {
        return sendError('Cannot consume this producer');
      }

      const consumer = await recvTransport.consume({
        producerId: producerToConsume.id,
        rtpCapabilities: peer.rtpCapabilities,
        paused: true,
      });

      consumer.on('transportclose', () => {
        console.log(`🚪 Consumer transport closed: ${consumer.kind} for ${peer.userName}`);
        const consumers = peerConsumers.get(socket.id) || [];
        const index = consumers.findIndex(c => c.id === consumer.id);
        if (index !== -1) {
          consumers.splice(index, 1);
          peerConsumers.set(socket.id, consumers);
        }
      });

      consumer.on('producerclose', () => {
        console.log(`👋 Producer closed, cleaning up consumer: ${consumer.kind} for ${peer.userName}`);
        socket.emit('producer_closed', {
          consumerId: consumer.id,
          producerId,
          kind: consumer.kind
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
        success: true,
        paused: consumer.paused
      });

      // Auto-resume after delay
      setTimeout(async () => {
        try {
          if (!consumer.closed && consumer.paused) {
            await consumer.resume();
            socket.emit('consumer_resumed', {
              consumerId: consumer.id,
              success: true
            });
            console.log(`▶️ Auto-resumed consumer: ${consumer.kind} for ${peer.userName}`);
          }
        } catch (error) {
          console.error('❌ Error auto-resuming consumer:', error);
        }
      }, 500);

      console.log(`🍿 Consumer created: ${consumer.kind} for ${peer.userName}`);

    } catch (error) {
      console.error('❌ Error creating consumer:', error);
      socket.emit('consumer_creation_failed', {
        producerId: data.producerId,
        error: error.message,
        code: error.code || 'CONSUMER_CREATION_FAILED'
      });
    }
  });

  // Resume consumer
  socket.on('resume_consumer', async (data) => {
    try {
      const { consumerId } = data;
      const consumers = peerConsumers.get(socket.id) || [];
      const consumer = consumers.find(c => c.id === consumerId);

      if (!consumer) {
        return sendError('Consumer not found');
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

  // Leave video call
  socket.on('leave_video_call', async () => {
    await cleanupVideoCallResources(socket.id, io);
    socket.emit('video_call_left');
  });

  // ICE restart
  socket.on('restart_ice', async (data) => {
    try {
      const { transportId, direction } = data;
      const transports = peerTransports.get(socket.id);
      const peer = videoPeers.get(socket.id);

      if (!transports || !peer) {
        return sendError('Transport or peer not found');
      }

      const transport = direction === 'send' ? transports.sendTransport : transports.recvTransport;

      if (!transport) {
        return sendError('Transport not found');
      }

      console.log(`🔄 Restarting ICE for ${direction} transport of ${peer.userName}`);

      await transport.restartIce();

      socket.emit('ice_restarted', {
        transportId,
        direction,
        iceParameters: transport.iceParameters,
        success: true
      });

    } catch (error) {
      console.error('❌ Error restarting ICE:', error);
      sendError('Failed to restart ICE');
    }
  });
};

module.exports = {
  initializeMediaSoup,
  getClassRouter,
  informExistingPeersOfNewProducer,
  cleanupVideoCallResources,
  setupVideoCallHandlers,
  videoPeers,
  peerTransports,
  peerProducers,
  peerConsumers
};
