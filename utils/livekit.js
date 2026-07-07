const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL; // e.g. wss://learnova-xxxx.livekit.cloud

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
  console.warn('⚠️  LiveKit env vars missing. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_WS_URL in .env');
}

const roomService = new RoomServiceClient(
  LIVEKIT_WS_URL ? LIVEKIT_WS_URL.replace('wss://', 'https://') : undefined,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

/**
 * Ensure a LiveKit room exists for a given roomId (our Mongo Meeting.roomId).
 * Throws on any failure that ISN'T "room already exists" so callers can react
 * (e.g. avoid marking a meeting 'active' when the room was never created).
 */
const ensureRoom = async (roomName, maxParticipants = 50) => {
  try {
    await roomService.createRoom({
      name: roomName,
      emptyTimeout: 10 * 60,
      maxParticipants,
    });
  } catch (error) {
    if (/already exists/i.test(error.message || '')) {
      return; // fine, room already exists
    }
    console.error('LiveKit ensureRoom error:', error.message);
    throw error; // was silently swallowed before — now callers can catch it
  }
};

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