// songSocket.js
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
    console.log(`[Queue] Room: ${room}, CurrentSinger: ${state.currentSinger}, Queue: ${state.queue.map(u => u.name).join(", ")}`);
  }

  function playNextSinger(room) {
    const state = songState[room];
    if (!state || !state.queue.length) return;

    const nextSinger = state.queue.shift();
    state.currentSinger = nextSinger.name;
    state.currentSingerSocketId = nextSinger.socketId;

    broadcastMicState(room);

    // 🔑 自動發送 LiveKit Token 給輪到的人
    const token = generateLiveKitToken(nextSinger.name, room);
    io.to(nextSinger.socketId).emit("livekit-token", { token });

    // 通知下一位開始唱
    io.to(nextSinger.socketId).emit("update-room-phase", { phase: "singing", singer: nextSinger.name });
  }

  // 生成 LiveKit token
  function generateLiveKitToken(name, room) {
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: name, ttl: 60 * 10 } // 10 分鐘
    );

    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,      // 只有輪到的人可以唱
      canSubscribe: true,
      canPublishData: true,
      hidden: false
    });

    return at.toJwt();
  }

  socket.on("joinQueue", ({ room, singer }) => {
    if (!songState[room]) songState[room] = { queue: [], currentSinger: null, currentSingerSocketId: null };
    const state = songState[room];

    if (!state.queue.find(u => u.name === singer) && state.currentSinger !== singer) {
      state.queue.push({ name: singer, socketId: socket.id });
    }

    if (!state.currentSinger) playNextSinger(room);
    else broadcastMicState(room);
  });

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

  socket.on("disconnect", () => {
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
