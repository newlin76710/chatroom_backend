import { songState } from "./song.js";
import { AccessToken } from "livekit-server-sdk";

export function songSocket(io, socket) {

  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;

    io.to(room).emit("micStateUpdate", {
      queue: state.queue.map(u => u.name),
      currentSinger: state.currentSinger || null
    });
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

    console.log(`[Debug] Sending LiveKit token to "${singer}" in room "${room}"`);
    io.to(socketId).emit("livekit-token", { token: token.toJwt() });
  }

  function playNextSinger(room) {
    const state = songState[room];
    if (!state || !state.queue.length) return;

    const nextSinger = state.queue.shift();
    state.currentSinger = nextSinger.name;
    state.currentSingerSocketId = nextSinger.socketId;

    console.log(`[Debug] Next singer for room "${room}": ${state.currentSinger}`);
    broadcastMicState(room);

    // 發送 LiveKit token 給下一位
    sendLiveKitToken(nextSinger.socketId, room, nextSinger.name);
  }

  // 加入 queue
  socket.on("joinQueue", ({ room, singer }) => {
    console.log(`🟢 join ${room} ${singer} (${socket.id})`);

    if (!songState[room])
      songState[room] = { queue: [], currentSinger: null, currentSingerSocketId: null };
    const state = songState[room];

    if (!state.queue.find(u => u.name === singer) && state.currentSinger !== singer) {
      state.queue.push({ name: singer, socketId: socket.id });
    }

    if (!state.currentSinger) {
      console.log(`[Debug] No current singer, calling playNextSinger for room "${room}"`);
      playNextSinger(room);
    } else {
      broadcastMicState(room);
    }
  });

  // 離開 queue
  socket.on("leaveQueue", ({ room, singer }) => {
    const state = songState[room];
    if (!state) return;

    state.queue = state.queue.filter(u => u.name !== singer);

    if (state.currentSinger === singer) {
      state.currentSinger = null;
      state.currentSingerSocketId = null;
      if (state.queue.length > 0) playNextSinger(room);
      else broadcastMicState(room);
    } else {
      broadcastMicState(room);
    }
  });

  // 停止唱歌
  socket.on("stopSing", ({ room, singer }) => {
    const state = songState[room];
    if (!state) return;

    if (state.currentSinger === singer) {
      state.currentSinger = null;
      state.currentSingerSocketId = null;
      if (state.queue.length > 0) playNextSinger(room);
      else broadcastMicState(room);
    }
  });

  // 斷線處理
  socket.on("disconnect", () => {
    console.log(`[Debug] Socket disconnected: ${socket.id}`);

    for (const room in songState) {
      const state = songState[room];
      if (!state) continue;

      const wasInQueue = state.queue.find(u => u.socketId === socket.id);
      state.queue = state.queue.filter(u => u.socketId !== socket.id);

      if (state.currentSingerSocketId === socket.id) {
        state.currentSinger = null;
        state.currentSingerSocketId = null;
        if (state.queue.length > 0) playNextSinger(room);
        else broadcastMicState(room);
      } else if (wasInQueue) {
        broadcastMicState(room);
      }
    }
  });
}
