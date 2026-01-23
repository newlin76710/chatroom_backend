// socketHandlers.js
import { songState } from "./song.js";
import { AccessToken } from "livekit-server-sdk";

export function songSocket(io, socket) {

  // 廣播當前隊列與正在唱的人
  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;

    io.to(room).emit("micStateUpdate", {
      queue: state.queue.map(u => u.name),
      currentSinger: state.currentSinger || null
    });

    console.log(`[Debug] broadcastMicState for room "${room}": currentSinger=${state.currentSinger}, queue=[${state.queue.map(u => u.name).join(", ")}]`);
  }

  // 發送 LiveKit token 給指定 socket
  function sendLiveKitToken(socketId, room, identity) {
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity, ttl: 600 } // 10 分鐘
    );

    token.addGrant({
      room,
      roomJoin: true,
      canPublish: true,      // 只有輪到唱的人能 publish
      canSubscribe: true,    // 聽眾可收聽
      canPublishData: true,  // DataChannel 可用
    });

    console.log(`[Debug] Sending LiveKit token to "${identity}" in room "${room}"`);
    io.to(socketId).emit("livekit-token", { token: token.toJwt(), identity });
  }

  // 播放下一位歌手
  function playNextSinger(room) {
    const state = songState[room];
    if (!state || !state.queue.length) return;

    const nextSinger = state.queue.shift();
    state.currentSinger = nextSinger.name;
    state.currentSingerSocketId = nextSinger.socketId;

    console.log(`[Debug] Next singer for room "${room}": ${state.currentSinger}`);
    broadcastMicState(room);

    // 發送 LiveKit token 給下一位
    sendLiveKitToken(nextSinger.socketId, room, nextSinger.socketId); // 使用 socketId 當 identity
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
      console.log(`[Debug] stopSing: ${singer} stopped singing in room "${room}"`);
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
        console.log(`[Debug] Current singer disconnected in room "${room}": ${state.currentSinger}`);
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
