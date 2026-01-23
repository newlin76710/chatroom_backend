// socketHandlers.js
import { songState } from "./song.js";
import { AccessToken } from "livekit-server-sdk";

export function songSocket(io, socket) {

  function logState(room) {
    const state = songState[room];
    console.log(`[Debug] Room "${room}" state:`, JSON.stringify(state, null, 2));
  }

  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;
    console.log(`[Debug] Broadcasting mic state for room "${room}"`);
    io.to(room).emit("micStateUpdate", {
      queue: state.queue.map(u => u.name),
      currentSinger: state.currentSinger || null
    });
    logState(room);
  }

  function sendLiveKitToken(socketId, room, singer) {
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: singer, ttl: 600 } // 10 分鐘
    );

    token.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    console.log(`[Debug] Sending LiveKit token to "${singer}" (socketId: ${socketId}) in room "${room}"`);
    io.to(socketId).emit("livekit-token", { token: token.toJwt() });
  }

  function playNextSinger(room) {
    const state = songState[room];
    if (!state || !state.queue.length) {
      console.log(`[Debug] No next singer in room "${room}"`);
      return;
    }

    const nextSinger = state.queue.shift();
    state.currentSinger = nextSinger.name;
    state.currentSingerSocketId = nextSinger.socketId;

    console.log(`[Debug] Next singer for room "${room}" is "${nextSinger.name}"`);
    broadcastMicState(room);
    sendLiveKitToken(nextSinger.socketId, room, nextSinger.name);
  }

  socket.on("joinQueue", ({ room, singer }) => {
    console.log(`[Debug] "${singer}" joining queue in room "${room}" (socketId: ${socket.id})`);
    if (!songState[room]) songState[room] = { queue: [], currentSinger: null, currentSingerSocketId: null };
    const state = songState[room];

    if (!state.queue.find(u => u.name === singer) && state.currentSinger !== singer) {
      state.queue.push({ name: singer, socketId: socket.id });
    }

    if (!state.currentSinger) playNextSinger(room);
    else broadcastMicState(room);
  });

  socket.on("leaveQueue", ({ room, singer }) => {
    console.log(`[Debug] "${singer}" leaving queue in room "${room}"`);
    const state = songState[room];
    if (!state) return;

    state.queue = state.queue.filter(u => u.name !== singer);

    if (state.currentSinger === singer) {
      console.log(`[Debug] Current singer "${singer}" left, clearing currentSinger`);
      state.currentSinger = null;
      state.currentSingerSocketId = null;
      if (state.queue.length > 0) playNextSinger(room);
      else broadcastMicState(room);
    } else {
      broadcastMicState(room);
    }
  });

  socket.on("stopSing", ({ room, singer }) => {
    console.log(`[Debug] "${singer}" stopped singing in room "${room}"`);
    const state = songState[room];
    if (!state) return;

    if (state.currentSinger === singer) {
      state.currentSinger = null;
      state.currentSingerSocketId = null;
      if (state.queue.length > 0) playNextSinger(room);
      else broadcastMicState(room);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[Debug] Socket disconnected: ${socket.id}`);
    for (const room in songState) {
      const state = songState[room];
      if (!state) continue;

      const wasInQueue = state.queue.find(u => u.socketId === socket.id);
      state.queue = state.queue.filter(u => u.socketId !== socket.id);

      if (state.currentSingerSocketId === socket.id) {
        console.log(`[Debug] Disconnected socket was current singer in room "${room}"`);
        state.currentSinger = null;
        state.currentSingerSocketId = null;
        if (state.queue.length > 0) playNextSinger(room);
        else broadcastMicState(room);
      } else if (wasInQueue) {
        broadcastMicState(room);
      }
    }
  });

  // WebRTC events
  socket.on("webrtc-offer", ({ room, offer, singer }) => {
    console.log(`[Debug] webrtc-offer from "${singer}" in room "${room}"`);
    socket.to(room).emit("webrtc-offer", { offer, singer });
  });

  socket.on("webrtc-answer", ({ room, answer }) => {
    console.log(`[Debug] webrtc-answer in room "${room}"`);
    socket.to(room).emit("webrtc-answer", { answer });
  });

  socket.on("webrtc-ice", ({ room, candidate }) => {
    console.log(`[Debug] webrtc-ice candidate in room "${room}"`);
    socket.to(room).emit("webrtc-ice", { candidate });
  });

  socket.on("webrtc-stop", ({ room }) => {
    console.log(`[Debug] webrtc-stop in room "${room}"`);
    socket.to(room).emit("webrtc-stop");
  });
}
