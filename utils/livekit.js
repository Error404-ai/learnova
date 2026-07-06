const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL; // e.g. wss://learnova-xxxx.livekit.cloud

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
  console.warn('⚠️  LiveKit env vars missing. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_WS_URL in .env');
}

// REST client for room management (uses the https:// form of your project URL)
const roomService = new RoomServiceClient(
  LIVEKIT_WS_URL ? LIVEKIT_WS_URL.replace('wss://', 'https://') : undefined,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

/**
 * Ensure a LiveKit room exists for a given roomId (our Mongo Meeting.roomId).
 * LiveKit auto-creates rooms on first join by default, but creating explicitly
 * lets us set emptyTimeout / maxParticipants to match our Meeting model.
 */
const ensureRoom = async (roomName, maxParticipants = 50) => {
  try {
    await roomService.createRoom({
      name: roomName,
      emptyTimeout: 10 * 60,       // close room 10 min after everyone leaves
      maxParticipants,
    });
  } catch (error) {
    // Room may already exist — that's fine, LiveKit throws on duplicate create in some SDK versions.
    // Only rethrow on unexpected failures.
    if (!/already exists/i.test(error.message || '')) {
      console.error('LiveKit ensureRoom error:', error.message);
    }
  }
};

/**
 * Generate a signed LiveKit access token (JWT) for a user joining a room.
 * role: 'moderator' | 'host'  -> teacher/coordinator permissions
 *       'participant'         -> student permissions
 */
const generateLiveKitToken = async (userId, userName, roomName, role = 'participant') => {
  const isModerator = role === 'moderator' || role === 'host';

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: userId.toString(),
    name: userName || userId.toString(),
    ttl: '2h',
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Only teachers/coordinators can mute others, end room for everyone, etc.
    roomAdmin: isModerator,
    roomRecord: isModerator,
  });

  const token = await at.toJwt();

  return {
    token,
    expires: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    wsUrl: LIVEKIT_WS_URL,
  };
};

/**
 * Force-end a room for everyone (used by endMeeting).
 */
const deleteRoom = async (roomName) => {
  try {
    await roomService.deleteRoom(roomName);
  } catch (error) {
    console.error('LiveKit deleteRoom error:', error.message);
  }
};

module.exports = {
  ensureRoom,
  generateLiveKitToken,
  deleteRoom,
  roomService,
};