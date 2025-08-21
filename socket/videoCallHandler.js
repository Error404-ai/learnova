const mediasoup = require('mediasoup')

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
       announcedIp: process.env.AWS_PUBLIC_IP || process.env.ANNOUNCED_IP,
      },
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    preferTcp: false,
    enableSctp: true,
    iceConsentTimeout: 30,
    enableIceRestart: true,
    portRange: {
      min: 10000,
      max: 20000
    }
  },
};

// MediaSoup instances
let mediasoupWorker;
const classRouters = new Map();
const peerTransports = new Map();
const peerProducers = new Map();
const peerConsumers = new Map();
const videoPeers = new Map();

// Producer health monitoring
const producerHealthCheck = new Map();

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

// Enhanced producer notification with validation
async function notifyPeersOfProducerChange(socketId, classId, producer, action, io) {
  try {
    const peer = videoPeers.get(socketId);
    if (!peer) return;

    const classPeers = Array.from(videoPeers.values())
      .filter(p => p.classId === classId && p.socketId !== socketId);

    console.log(`📡 ${action} - Notifying ${classPeers.length} peers about producer ${producer.id}`);

    for (const existingPeer of classPeers) {
      const existingSocket = io.sockets.sockets.get(existingPeer.socketId);
      if (!existingSocket || !existingSocket.connected) continue;

      if (action === 'created') {
        // Double-check producer is still valid before notifying
        if (!producer.closed) {
          existingSocket.emit('new_producer', {
            producerId: producer.id,
            kind: producer.kind,
            producerSocketId: socketId,
            producerName: peer.userName,
          });
        }
      } else if (action === 'closed') {
        existingSocket.emit('producer_closed', {
          producerId: producer.id,
          kind: producer.kind,
          socketId: socketId,
          producerSocketId: socketId
        });
      }
    }
  } catch (error) {
    console.error('❌ Error notifying peers of producer change:', error);
  }
}

// Enhanced producer health monitoring
function startProducerHealthMonitoring(socketId, producer, classId, io) {
  const healthCheckId = `${socketId}-${producer.kind}`;
  
  // Clear any existing health check
  if (producerHealthCheck.has(healthCheckId)) {
    clearInterval(producerHealthCheck.get(healthCheckId));
  }

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3; // Allow 3 failures before closing

  const healthInterval = setInterval(() => {
    if (producer.closed) {
      console.log(`💔 Producer ${producer.id} detected as closed during health check`);
      notifyPeersOfProducerChange(socketId, classId, producer, 'closed', io);
      clearInterval(healthInterval);
      producerHealthCheck.delete(healthCheckId);
      return;
    }

    // Check transport state with tolerance
    const transports = peerTransports.get(socketId);
    if (!transports || !transports.sendTransport) {
      consecutiveFailures++;
      console.log(`⚠️ Transport not found for producer ${producer.id} (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
      
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(`💔 Transport consistently unavailable for producer ${producer.id}, closing`);
        if (!producer.closed) {
          producer.close();
        }
        notifyPeersOfProducerChange(socketId, classId, producer, 'closed', io);
        clearInterval(healthInterval);
        producerHealthCheck.delete(healthCheckId);
      }
      return;
    }

    if (transports.sendTransport.closed) {
      consecutiveFailures++;
      console.log(`⚠️ Send transport closed for producer ${producer.id} (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
      
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(`💔 Transport consistently closed for producer ${producer.id}, closing`);
        if (!producer.closed) {
          producer.close();
        }
        notifyPeersOfProducerChange(socketId, classId, producer, 'closed', io);
        clearInterval(healthInterval);
        producerHealthCheck.delete(healthCheckId);
      }
    } else {
      // Reset failure count if transport is healthy
      consecutiveFailures = 0;
    }
  }, 10000); // Increased interval to 10 seconds

  producerHealthCheck.set(healthCheckId, healthInterval);

  // Auto-cleanup after 30 minutes
  setTimeout(() => {
    if (producerHealthCheck.has(healthCheckId)) {
      clearInterval(producerHealthCheck.get(healthCheckId));
      producerHealthCheck.delete(healthCheckId);
    }
  }, 30 * 60 * 1000);
}

// Inform existing peers of new producer
async function informExistingPeersOfNewProducer(newPeerSocketId, classId, newProducer, io) {
  try {
    // Add delay to ensure producer is fully ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (newProducer.closed) {
      console.warn('⚠️ Producer closed before informing peers');
      return;
    }

    await notifyPeersOfProducerChange(newPeerSocketId, classId, newProducer, 'created', io);
    
    // Start health monitoring
    startProducerHealthMonitoring(newPeerSocketId, newProducer, classId, io);
    
  } catch (error) {
    console.error('❌ Error informing existing peers of new producer:', error);
  }
}

// Inform new peer of existing producers
function informNewPeerOfExistingProducers(newPeerSocketId, classId, io) {
  const logPrefix = '[INFORM-PRODUCERS]';
  try {
    const newPeer = videoPeers.get(newPeerSocketId);
    console.log(`${logPrefix} 📡 Informing ${newPeer?.userName} (${newPeerSocketId}) of existing producers in class ${classId}`);

    const producers = [];
    let totalProducers = 0;
    let ownProducers = 0;
    let closedProducers = 0;

    for (const [socketId, peer] of videoPeers.entries()) {
      if (peer.classId === classId) {
        const userProducers = peerProducers.get(socketId);
        console.log(`${logPrefix} 🔍 Checking peer ${peer.userName} (${socketId}): ${userProducers ? Object.keys(userProducers).length : 0} producers`);
        
        if (userProducers) {
          for (const [kind, producer] of Object.entries(userProducers)) {
            totalProducers++;
            
            if (socketId === newPeerSocketId) {
              ownProducers++;
              console.log(`${logPrefix} ⏭️ Skipping own producer: ${kind} (${producer?.id})`);
              continue;
            }

            if (!producer || producer.closed) {
              closedProducers++;
              console.log(`${logPrefix} ⏭️ Skipping closed producer: ${kind} (${producer?.id || 'null'})`);
              continue;
            }

            const producerInfo = {
              producerId: producer.id,
              kind: kind,
              producerSocketId: socketId,
              producerName: peer.userName,
            };
            
            producers.push(producerInfo);
            console.log(`${logPrefix} ➕ Added producer: ${kind} from ${peer.userName} (${producer.id})`);
          }
        }
      }
    }
    
    console.log(`${logPrefix} 📊 Producer summary:`, {
      total: totalProducers,
      own: ownProducers,
      closed: closedProducers,
      toSend: producers.length
    });

    const newPeerSocket = io.sockets.sockets.get(newPeerSocketId);
    if (newPeerSocket && newPeerSocket.connected) {
      console.log(`${logPrefix} 📤 Sending ${producers.length} existing producers to ${newPeer?.userName}`);
      
      newPeerSocket.emit('existing_producers', producers);
      console.log(`${logPrefix} ✅ Successfully sent existing_producers event to ${newPeerSocketId}`);
    } else {
      console.warn(`${logPrefix} ⚠️ New peer socket ${newPeerSocketId} not found or not connected`);
    }
  } catch (error) {
    console.error(`${logPrefix} ❌ Error informing new peer of existing producers:`, error);
  }
}

// Enhanced cleanup with proper peer notification
async function cleanupVideoCallResources(socketId, io) {
  try {
    console.log(`🧹 Starting cleanup for socket ${socketId}`);

    const peer = videoPeers.get(socketId);
    
    // Notify other peers about producers being closed BEFORE actually closing them
    if (peer && peer.classId && io) {
      const producersToClose = peerProducers.get(socketId);
      if (producersToClose) {
        for (const [kind, producer] of Object.entries(producersToClose)) {
          if (producer && !producer.closed) {
            // Notify peers first
            await notifyPeersOfProducerChange(socketId, peer.classId, producer, 'closed', io);
            
            // Clean up health monitoring
            const healthCheckId = `${socketId}-${kind}`;
            if (producerHealthCheck.has(healthCheckId)) {
              clearInterval(producerHealthCheck.get(healthCheckId));
              producerHealthCheck.delete(healthCheckId);
            }
          }
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

      videoPeers.set(socket.id, {
        socketId: socket.id,
        classId: user.classId,
        userId: user.userId,
        userName: user.userName,
        userRole: user.userRole,
        rtpCapabilities: null,
      });

      peerConsumers.set(socket.id, []);

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

      // Enhanced transport event handling
     const setupTransportHandlers = (transport, direction) => {
  const trackingKey = `${socket.id}-${direction}`;
  
  transport.on('dtlsstatechange', (dtlsState) => {
    console.log(`📡 ${direction} transport DTLS: ${dtlsState} for ${peer.userName}`);
    
    if (dtlsState === 'connected') {
      console.log(`✅ ${direction} transport fully connected for ${peer.userName}`);
      // Reset failure tracking on successful connection
      if (transportFailureTracking.has(trackingKey)) {
        transportFailureTracking.delete(trackingKey);
      }
      
      // Inform about existing producers when receive transport is ready
      if (direction === 'recv') {
        setTimeout(() => {
          console.log(`🔍 Auto-informing ${peer.userName} of existing producers after recv transport connected`);
          informNewPeerOfExistingProducers(socket.id, peer.classId, io);
        }, 500);
      }
    } else if (dtlsState === 'failed' || dtlsState === 'closed') {
      console.error(`❌ ${direction} transport DTLS ${dtlsState} for ${peer.userName}`);
      
      // Track failures instead of immediately closing
      if (!transportFailureTracking.has(trackingKey)) {
        transportFailureTracking.set(trackingKey, { count: 0, lastFailure: Date.now() });
      }
      
      const tracking = transportFailureTracking.get(trackingKey);
      tracking.count++;
      tracking.lastFailure = Date.now();
      
      console.log(`⚠️ Transport failure count: ${tracking.count} for ${peer.userName}`);
      
      // Only close producers after multiple failures within a short time
      if (tracking.count >= 3 && direction === 'send') {
        console.log(`💔 Multiple transport failures detected, closing producers for ${peer.userName}`);
        
        const producers = peerProducers.get(socket.id);
        if (producers) {
          Object.entries(producers).forEach(async ([kind, producer]) => {
            if (producer && !producer.closed) {
              await notifyPeersOfProducerChange(socket.id, peer.classId, producer, 'closed', io);
              producer.close();
            }
          });
        }
      }
    }
  });

  transport.on('icestatechange', (iceState) => {
    console.log(`🧊 ${direction} transport ICE: ${iceState} for ${peer.userName}`);
    
    if (iceState === 'connected' || iceState === 'completed') {
      // Reset failure tracking on successful ICE connection
      if (transportFailureTracking.has(trackingKey)) {
        transportFailureTracking.delete(trackingKey);
      }
    } else if (iceState === 'failed') {
      console.error(`❌ ${direction} transport ICE failed for ${peer.userName}`);
      // Don't immediately close - let DTLS handler manage this
    }
  });

  transport.on('connectionstatechange', (connectionState) => {
    console.log(`🔗 ${direction} transport connection: ${connectionState} for ${peer.userName}`);
    
    if (connectionState === 'connected') {
      // Reset failure tracking on successful connection
      if (transportFailureTracking.has(trackingKey)) {
        transportFailureTracking.delete(trackingKey);
      }
    } else if (connectionState === 'failed') {
      console.error(`❌ ${direction} transport connection failed for ${peer.userName}`);
      
      // Give it time to recover before closing producers
      setTimeout(() => {
        if (transport.connectionState === 'failed' && direction === 'send') {
          console.log(`💔 Transport connection still failed after timeout, closing producers for ${peer.userName}`);
          
          const producers = peerProducers.get(socket.id);
          if (producers) {
            Object.entries(producers).forEach(async ([kind, producer]) => {
              if (producer && !producer.closed) {
                await notifyPeersOfProducerChange(socket.id, peer.classId, producer, 'closed', io);
                producer.close();
              }
            });
          }
        }
      }, 10000); // Wait 10 seconds before giving up
    }
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

      console.log(`🚛 Transports created for ${peer.userName}`);

    } catch (error) {
      console.error('❌ Error creating transports:', error);
      sendError(`Failed to create transports: ${error.message}`);
    }
  });

  // Enhanced connect transport with better error handling
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

      await transport.connect({ dtlsParameters });

      // Enhanced DTLS connection verification
      if (transport.dtlsState !== 'connected') {
        console.log(`⏳ Waiting for DTLS connection...`);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            transport.off('dtlsstatechange', handler);
            reject(new Error('DTLS connection timeout'));
          }, 15000); // Increased timeout

          const handler = (state) => {
            if (state === 'connected') {
              clearTimeout(timeout);
              transport.off('dtlsstatechange', handler);
              resolve();
            } else if (state === 'failed' || state === 'closed') {
              clearTimeout(timeout);
              transport.off('dtlsstatechange', handler);
              reject(new Error(`DTLS connection failed: ${state}`));
            }
          };
          transport.on('dtlsstatechange', handler);
        });
      }

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

  // Enhanced start producing with better lifecycle management
  socket.on('start_producing', async (data) => {
  try {
    const { kind, rtpParameters } = data;
    const peer = videoPeers.get(socket.id);
    const transports = peerTransports.get(socket.id);

    if (!peer || !transports) {
      return sendError('Peer or transport not found');
    }

    // Validate transport is ready before creating producer
    const sendTransport = transports.sendTransport;
    if (!sendTransport || sendTransport.closed) {
      console.error(`❌ Send transport not available for ${peer.userName}`);
      return sendError('Send transport not available');
    }

    // Check transport state before proceeding
    if (sendTransport.connectionState !== 'connected' && sendTransport.dtlsState !== 'connected') {
      console.warn(`⚠️ Transport not fully connected for ${peer.userName}, state: ${sendTransport.connectionState}, DTLS: ${sendTransport.dtlsState}`);
      
      // Wait a bit for connection to establish
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (sendTransport.connectionState !== 'connected' && sendTransport.dtlsState !== 'connected') {
        return sendError('Transport not ready for producing');
      }
    }

    console.log(`🎬 Creating ${kind} producer for ${peer.userName}`);

    const producer = await sendTransport.produce({
      kind,
      rtpParameters,
    });

    // Enhanced producer event handling with less aggressive cleanup
    producer.on('transportclose', async () => {
      console.log(`Producer transport closed: ${kind} for ${peer.userName}`);
      
      // Don't immediately notify - transport might recover
      setTimeout(async () => {
        if (producer.closed) {
          await notifyPeersOfProducerChange(socket.id, peer.classId, producer, 'closed', io);
          
          // Clean up from storage
          const userProducers = peerProducers.get(socket.id);
          if (userProducers && userProducers[kind]) {
            delete userProducers[kind];
            if (Object.keys(userProducers).length === 0) {
              peerProducers.delete(socket.id);
            }
          }

          // Clean up health monitoring
          const healthCheckId = `${socket.id}-${kind}`;
          if (producerHealthCheck.has(healthCheckId)) {
            clearInterval(producerHealthCheck.get(healthCheckId));
            producerHealthCheck.delete(healthCheckId);
          }
        }
      }, 2000); // Give 2 seconds for potential recovery
    });

    producer.on('trackended', async () => {
      console.log(`Producer track ended: ${kind} for ${peer.userName}`);
      
      // Track ended is usually final - clean up immediately
      await notifyPeersOfProducerChange(socket.id, peer.classId, producer, 'closed', io);
      
      const userProducers = peerProducers.get(socket.id);
      if (userProducers && userProducers[kind]) {
        delete userProducers[kind];
      }
    });

    // Store the producer
    if (!peerProducers.has(socket.id)) {
      peerProducers.set(socket.id, {});
    }
    const producers = peerProducers.get(socket.id);
    producers[kind] = producer;

    console.log(`✅ Producer created: ${kind} for ${peer.userName} - ID: ${producer.id}`);

    // Send success response first
    socket.emit('producer_created', {
      kind,
      producerId: producer.id,
      success: true
    });

    // Wait longer before informing peers to ensure producer is stable
    setTimeout(async () => {
      if (!producer.closed && sendTransport && !sendTransport.closed) {
        console.log(`📢 Informing other peers about new ${kind} producer from ${peer.userName}`);
        await informExistingPeersOfNewProducer(socket.id, peer.classId, producer, io);
      } else {
        console.warn(`⚠️ Producer or transport closed before informing peers`);
      }
    }, 1000); // Increased delay to 1 second

  } catch (error) {
    console.error('❌ Error creating producer:', error);
    sendError(`Failed to create producer: ${error.message}`);
  }
});

  // Rest of the handlers remain the same but with enhanced error handling...
  // (keeping the existing handlers for brevity but they should also have similar enhancements)

  // Enhanced start consuming with better validation
  socket.on('start_consuming', async (data) => {
    const logPrefix = `[CONSUME-SERVER]`;
    console.log(`${logPrefix} 📥 Consume request received:`, {
      producerId: data.producerId,
      hasRtpCapabilities: !!data.consumerRtpCapabilities,
      socketId: socket.id
    });

    try {
      const { producerId, consumerRtpCapabilities } = data;
      const peer = videoPeers.get(socket.id);
      const transports = peerTransports.get(socket.id);

      // Enhanced validation
      if (!peer) {
        console.error(`${logPrefix} ❌ Peer not found for socket ${socket.id}`);
        return socket.emit('consumer_creation_failed', {
          producerId,
          reason: 'Peer not found',
          code: 'PEER_NOT_FOUND'
        });
      }

      if (!transports) {
        console.error(`${logPrefix} ❌ Transports not found for peer ${peer.userName}`);
        return socket.emit('consumer_creation_failed', {
          producerId,
          reason: 'Transport not found',
          code: 'TRANSPORT_NOT_FOUND'
        });
      }

      const recvTransport = transports.recvTransport;
      if (!recvTransport || recvTransport.closed) {
        console.error(`${logPrefix} ❌ Receive transport not available for ${peer.userName}`);
        return socket.emit('consumer_creation_failed', {
          producerId,
          reason: 'Receive transport not available',
          code: 'TRANSPORT_NOT_AVAILABLE'
        });
      }

      if (!consumerRtpCapabilities) {
        console.error(`${logPrefix} ❌ No RTP capabilities provided`);
        return socket.emit('consumer_creation_failed', {
          producerId,
          reason: 'No RTP capabilities provided',
          code: 'NO_RTP_CAPABILITIES'
        });
      }

      // Find the producer to consume with enhanced search
      let producerToConsume;
      let producerPeer;
      let producerKind;

      console.log(`${logPrefix} 🔍 Searching for producer ${producerId}...`);

      for (const [socketId, producers] of peerProducers.entries()) {
        const peerName = videoPeers.get(socketId)?.userName || 'Unknown';
        
        if (producers) {
          for (const [kind, producer] of Object.entries(producers)) {
            if (producer && producer.id === producerId) {
              // Double-check producer is still valid
              if (!producer.closed) {
                producerToConsume = producer;
                producerPeer = videoPeers.get(socketId);
                producerKind = kind;
                console.log(`${logPrefix} ✅ Found valid producer!`, {
                  kind,
                  producerId: producer.id,
                  fromPeer: producerPeer?.userName
                });
                break;
              } else {
                console.warn(`${logPrefix} ⚠️ Found producer but it's closed`);
                return socket.emit('consumer_creation_failed', {
                  producerId,
                  reason: 'Producer is closed',
                  code: 'PRODUCER_CLOSED'
                });
              }
            }
          }
          if (producerToConsume) break;
        }
      }

      if (!producerToConsume) {
        console.error(`${logPrefix} ❌ Producer not found`);
        
        // Log all available producers for debugging
        console.log(`${logPrefix} 📋 Available producers:`);
        for (const [socketId, producers] of peerProducers.entries()) {
          const peerName = videoPeers.get(socketId)?.userName || 'Unknown';
          for (const [kind, producer] of Object.entries(producers || {})) {
            console.log(`${logPrefix}   - ${peerName}: ${kind} producer ${producer?.id} (closed: ${producer?.closed})`);
          }
        }
        
        return socket.emit('consumer_creation_failed', {
          producerId,
          reason: 'Producer not found',
          code: 'PRODUCER_NOT_FOUND'
        });
      }

      const router = await getClassRouter(peer.classId);

      // Check if peer can consume with detailed logging
      console.log(`${logPrefix} 🧪 Checking if can consume...`);
      const canConsume = router.canConsume({
        producerId: producerToConsume.id,
        rtpCapabilities: consumerRtpCapabilities
      });

      if (!canConsume) {
        console.error(`${logPrefix} ❌ Cannot consume - incompatible capabilities`);
        return socket.emit('consumer_creation_failed', {
          producerId,
          reason: 'Cannot consume this producer - incompatible capabilities',
          code: 'INCOMPATIBLE_CAPABILITIES'
        });
      }

      console.log(`${logPrefix} ✅ Can consume! Creating consumer for ${peer.userName} from ${producerPeer?.userName} (${producerKind})`);

      // Create the consumer with error handling
      let consumer;
      try {
        consumer = await recvTransport.consume({
          producerId: producerToConsume.id,
          rtpCapabilities: consumerRtpCapabilities,
          paused: false,
        });

        console.log(`${logPrefix} 🎉 Consumer created successfully:`, {
          consumerId: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          paused: consumer.paused
        });

      } catch (consumeError) {
        console.error(`${logPrefix} ❌ Error creating consumer:`, consumeError);
        return socket.emit('consumer_creation_failed', {
          producerId,
          reason: `Consumer creation failed: ${consumeError.message}`,
          code: 'CONSUMER_CREATION_ERROR',
          error: consumeError.message
        });
      }

      // Enhanced consumer event handlers
      consumer.on('transportclose', () => {
        console.log(`${logPrefix} 🚪 Consumer transport closed: ${consumer.kind} for ${peer.userName}`);
        
        // Clean up consumer from storage
        const consumers = peerConsumers.get(socket.id) || [];
        const index = consumers.findIndex(c => c.id === consumer.id);
        if (index !== -1) {
          consumers.splice(index, 1);
          peerConsumers.set(socket.id, consumers);
        }
      });

      consumer.on('producerclose', () => {
        console.log(`${logPrefix} 👋 Producer closed, cleaning up consumer: ${consumer.kind} for ${peer.userName}`);
        
        // Notify client that producer was closed
        socket.emit('producer_closed', {
          consumerId: consumer.id,
          producerId,
          kind: consumer.kind,
          reason: 'Producer closed'
        });

        // Clean up consumer
        const consumers = peerConsumers.get(socket.id) || [];
        const index = consumers.findIndex(c => c.id === consumer.id);
        if (index !== -1) {
          consumers.splice(index, 1);
          peerConsumers.set(socket.id, consumers);
        }
      });

      consumer.on('producerpause', () => {
        console.log(`${logPrefix} ⏸️ Producer paused, pausing consumer: ${consumer.kind}`);
        socket.emit('producer_paused', {
          consumerId: consumer.id,
          producerId,
          kind: consumer.kind
        });
      });

      consumer.on('producerresume', () => {
        console.log(`${logPrefix} ▶️ Producer resumed, resuming consumer: ${consumer.kind}`);
        socket.emit('producer_resumed', {
          consumerId: consumer.id,
          producerId,
          kind: consumer.kind
        });
      });

      // Store the consumer
      const consumers = peerConsumers.get(socket.id) || [];
      consumers.push(consumer);
      peerConsumers.set(socket.id, consumers);

      // Send success response to client
      const response = {
        consumerId: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        success: true,
        paused: consumer.paused,
        producerPeer: producerPeer ? {
          socketId: producerPeer.socketId,
          userName: producerPeer.userName,
          userId: producerPeer.userId
        } : null
      };

      console.log(`${logPrefix} 📤 Sending consumer_created response:`, {
        consumerId: response.consumerId,
        kind: response.kind,
        paused: response.paused,
        producerPeer: response.producerPeer?.userName
      });

      socket.emit('consumer_created', response);

      console.log(`${logPrefix} ✅ Consumer creation completed for ${consumer.kind} from ${producerPeer?.userName} to ${peer.userName}`);

    } catch (error) {
      console.error(`${logPrefix} ❌ Unexpected error in start_consuming:`, error);
      socket.emit('consumer_creation_failed', {
        producerId: data.producerId,
        reason: `Unexpected error: ${error.message}`,
        code: 'UNEXPECTED_ERROR',
        error: error.message
      });
    }
  });

  // Get existing producers - Enhanced version
  socket.on('get_existing_producers', () => {
    const peer = videoPeers.get(socket.id);
    if (peer) {
      console.log(`📡 Manual request for existing producers from ${peer.userName} (${socket.id})`);
      console.log(`🏫 Class ID: ${peer.classId}`);
      
      // Add debug info about current state
      console.log(`🔍 Current peers in class:`, Array.from(videoPeers.entries())
        .filter(([_, p]) => p.classId === peer.classId)
        .map(([socketId, p]) => ({ 
          socketId, 
          name: p.userName, 
          hasProducers: peerProducers.has(socketId),
          producers: peerProducers.has(socketId) ? Object.keys(peerProducers.get(socketId)) : []
        }))
      );
      
      informNewPeerOfExistingProducers(socket.id, peer.classId, io);
    } else {
      console.warn(`⚠️ get_existing_producers called but peer not found for socket ${socket.id}`);
      socket.emit('existing_producers', []);
    }
  });

  // Debug endpoint
  socket.on('debug_server_state', () => {
    const peer = videoPeers.get(socket.id);
    if (peer) {
      const debugInfo = {
        peer: {
          socketId: socket.id,
          userName: peer.userName,
          classId: peer.classId
        },
        transports: {
          hasTransports: peerTransports.has(socket.id),
          sendTransportClosed: peerTransports.get(socket.id)?.sendTransport?.closed,
          recvTransportClosed: peerTransports.get(socket.id)?.recvTransport?.closed
        },
        producers: {
          count: peerProducers.has(socket.id) ? Object.keys(peerProducers.get(socket.id)).length : 0,
          kinds: peerProducers.has(socket.id) ? Object.keys(peerProducers.get(socket.id)) : []
        },
        consumers: {
          count: peerConsumers.has(socket.id) ? peerConsumers.get(socket.id).length : 0
        },
        classmates: Array.from(videoPeers.entries())
          .filter(([_, p]) => p.classId === peer.classId && p.socketId !== socket.id)
          .map(([socketId, p]) => ({
            socketId,
            userName: p.userName,
            hasProducers: peerProducers.has(socketId),
            producerKinds: peerProducers.has(socketId) ? Object.keys(peerProducers.get(socketId)) : []
          }))
      };
      
      console.log(`🐛 Debug info for ${peer.userName}:`, JSON.stringify(debugInfo, null, 2));
      socket.emit('debug_server_response', debugInfo);
    }
  });

  // Leave video call
  socket.on('leave_video_call', async () => {
    await cleanupVideoCallResources(socket.id, io);
    socket.emit('video_call_left');
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    await cleanupVideoCallResources(socket.id, io);
  });
};
setInterval(() => {
  const now = Date.now();
  const CLEANUP_THRESHOLD = 5 * 60 * 1000; // 5 minutes
  
  for (const [key, tracking] of transportFailureTracking.entries()) {
    if (now - tracking.lastFailure > CLEANUP_THRESHOLD) {
      transportFailureTracking.delete(key);
    }
  }
}, 60 * 1000);
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