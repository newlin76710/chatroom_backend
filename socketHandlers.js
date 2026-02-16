// socketHandlers.js
import { songState } from "./song.js";
import { AccessToken } from "livekit-server-sdk";

export function songSocket(io, socket) {

  // 廣播當前排隊名單與唱歌人
  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;

    io.to(`song-${room}`).emit("micStateUpdate", {
      queue: Array.from(state.queue.keys()), // queue 名單
      currentSinger: state.currentSinger || null,
    });

    console.log(`[Debug] broadcastMicState for room "${room}": currentSinger=${state.currentSinger}`);
  }

  // 指派下一位上麥
  function assignNextSinger(room) {
    const state = songState[room];
    if (!state) return;

    if (state.currentSinger) return; // 已有人唱

    const firstEntry = state.queue.entries().next();
    if (firstEntry.done) {
      broadcastMicState(room);
      return;
    }

    const [name, user] = firstEntry.value;
    io.to(user.socketId).emit("pleaseGrabMic", { room, singer: name });
    broadcastMicState(room);
  }

  // 產生 LiveKit token
  async function sendLiveKitToken(socketId, room, identity) {
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity, ttl: 600 }
    );

    token.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();
    io.to(socketId).emit("livekit-token", { token: jwt, identity });
  }

  // 加入房間
  socket.on("joinRoom", ({ room, name }) => {
    if (!room || !name) {
      console.warn("[Warning] joinRoom missing room or name", { room, name });
      return;
    }

    if (!songState[room]) songState[room] = { queue: new Map(), currentSinger: null };

    socket.join(`song-${room}`);

    const state = songState[room];
    socket.emit("micStateUpdate", {
      queue: Array.from(state.queue.keys()),
      currentSinger: state.currentSinger || null,
    });

    console.log(`[Debug] ${name} 進入 song room ${room}`);
  });

  // 點上麥 → 加入 queue
  socket.on("joinQueue", ({ room, name }) => {
    if (!room || !name) return;

    if (!songState[room]) songState[room] = { queue: new Map(), currentSinger: null };
    const state = songState[room];

    // 確保 queue 是 Map（兼容舊資料）
    if (!(state.queue instanceof Map)) {
      state.queue = new Map(state.queue.map(u => [u.name, { socketId: u.socketId }]));
    }

    if (state.queue.has(name) || state.currentSinger === name) return;

    state.queue.set(name, { socketId: socket.id });
    broadcastMicState(room);

    assignNextSinger(room);
  });

  // 真正上麥
  socket.on("grabMic", async ({ room, singer }) => {
    const state = songState[room];
    if (!state) return;

    const firstEntry = state.queue.entries().next();
    if (firstEntry.done || firstEntry.value[0] !== singer) return; // 確保輪到第一位

    state.currentSinger = singer;
    state.queue.delete(singer);

    broadcastMicState(room);

    const socketId = firstEntry.value[1].socketId;
    await sendLiveKitToken(socketId, room, singer);
  });

  // 下麥
  socket.on("stopSing", ({ room }) => {
    const state = songState[room];
    if (!state) return;

    if (state.currentSinger) {
      state.currentSinger = null;
      assignNextSinger(room);
    }
  });

  // 斷線處理
  socket.on("disconnect", () => {
    for (const room in songState) {
      const state = songState[room];
      if (!state) continue;

      // 如果斷線的是正在唱的人
      if (state.currentSinger) {
        const currentName = state.currentSinger;
        if (currentName && state.queue.get(currentName)?.socketId === socket.id) {
          state.currentSinger = null;
          assignNextSinger(room);
        }
      }

      // 從 queue 移除自己
      for (const [name, user] of state.queue.entries()) {
        if (user.socketId === socket.id) state.queue.delete(name);
      }

      broadcastMicState(room);
    }
  });
}
