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
      currentSinger: state.currentSinger || null,
    });

    console.log(`[Debug] broadcastMicState for room "${room}": currentSinger=${state.currentSinger}, queue=[${state.queue.map(u => u.name).join(", ")}]`);
  }

  // 發送 LiveKit token 給指定 socket
  async function sendLiveKitToken(socketId, room, identity) {
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity, ttl: 600 } // 10 分鐘
    );

    token.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt(); // ✅ 必須 await
    console.log(`[Debug] Sending LiveKit JWT token to "${identity}" in room "${room}": ${jwt}`);
    io.to(socketId).emit("livekit-token", { token: jwt, identity });
  }

  // 播放下一位歌手
  async function playNextSinger(room) {
    const state = songState[room];
    if (!state || !state.queue.length) return;

    const nextSinger = state.queue.shift();
    state.currentSinger = nextSinger.name;
    state.currentSingerSocketId = nextSinger.socketId;

    broadcastMicState(room);

    // 發送 LiveKit token 給下一位
    await sendLiveKitToken(nextSinger.socketId, room, nextSinger.name);
  }

  // 搶 Mic / 踢掉正在唱的人
  socket.on("grabMic", async ({ room, singer }) => {
    if (!songState[room]) songState[room] = { queue: [], currentSinger: null, currentSingerSocketId: null };
    const state = songState[room];

    // 如果有人正在唱，踢掉他
    if (state.currentSingerSocketId && state.currentSingerSocketId !== socket.id) {
      console.log(`[Debug] ${singer} 踢掉 ${state.currentSinger}`);
      io.to(state.currentSingerSocketId).emit("forceStopSing");
      state.queue.unshift({ name: state.currentSinger, socketId: state.currentSingerSocketId }); // 放回 queue
    }

    // 設自己為當前歌手
    state.currentSinger = singer;
    state.currentSingerSocketId = socket.id;

    // 從 queue 移除自己
    state.queue = state.queue.filter(u => u.socketId !== socket.id);

    broadcastMicState(room);

    // 發 token 給自己
    await sendLiveKitToken(socket.id, room, singer);
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

  // 強制斷線停止
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
