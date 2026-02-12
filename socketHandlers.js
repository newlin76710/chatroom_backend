import { songState } from "./song.js";
import { AccessToken } from "livekit-server-sdk";

export function songSocket(io, socket) {

  //////////////////////////////////////////////////////
  // 廣播麥序
  //////////////////////////////////////////////////////

  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;

    io.to(`song-${room}`).emit("micStateUpdate", {
      queue: state.queue.map(u => u.name),
      currentSinger: state.currentSinger?.name || null,
    });
  }

  //////////////////////////////////////////////////////
  // LiveKit Token
  //////////////////////////////////////////////////////

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

  //////////////////////////////////////////////////////
  // 叫下一位（核心🔥）
  //////////////////////////////////////////////////////

  async function callNextSinger(room) {
    const state = songState[room];
    if (!state) return;

    if (state.queue.length === 0) {
      state.currentSinger = null;
      broadcastMicState(room);
      return;
    }

    const next = state.queue.shift();

    state.currentSinger = next;

    broadcastMicState(room);

    await sendLiveKitToken(next.socketId, room, next.name);
  }

  //////////////////////////////////////////////////////
  // 進房
  //////////////////////////////////////////////////////

  socket.on("joinRoom", ({ room, name }) => {

    if (!songState[room]) {
      songState[room] = {
        queue: [],
        currentSinger: null,
      };
    }

    socket.data.name = name;
    socket.data.room = room;

    socket.join(`song-${room}`);

    broadcastMicState(room);
  });

  //////////////////////////////////////////////////////
  // 排隊 / 上麥
  //////////////////////////////////////////////////////

  socket.on("grabMic", async ({ room, singer }) => {

    const state = songState[room];
    if (!state) return;

    // 已在唱
    if (state.currentSinger?.socketId === socket.id) return;

    // 已在排隊
    if (state.queue.find(u => u.socketId === socket.id)) return;

    ////////////////////////////////////////////////////
    // 沒人唱 → 直接上麥
    ////////////////////////////////////////////////////

    if (!state.currentSinger) {

      state.currentSinger = {
        socketId: socket.id,
        name: singer
      };

      broadcastMicState(room);

      await sendLiveKitToken(socket.id, room, singer);

      return;
    }

    ////////////////////////////////////////////////////
    // 有人唱 → 排隊
    ////////////////////////////////////////////////////

    state.queue.push({
      socketId: socket.id,
      name: singer
    });

    broadcastMicState(room);
  });

  //////////////////////////////////////////////////////
  // 下麥
  //////////////////////////////////////////////////////

  socket.on("stopSing", async ({ room }) => {

    const state = songState[room];
    if (!state) return;

    if (state.currentSinger?.socketId !== socket.id) return;

    state.currentSinger = null;

    await callNextSinger(room);
  });

  //////////////////////////////////////////////////////
  // 離線（超重要🔥）
  //////////////////////////////////////////////////////

  socket.on("disconnect", async () => {

    const room = socket.data.room;
    if (!room) return;

    const state = songState[room];
    if (!state) return;

    ////////////////////////////////////////////////////
    // 如果正在唱 → 叫下一位
    ////////////////////////////////////////////////////

    if (state.currentSinger?.socketId === socket.id) {
      state.currentSinger = null;
      await callNextSinger(room);
      return;
    }

    ////////////////////////////////////////////////////
    // 從隊列移除
    ////////////////////////////////////////////////////

    state.queue = state.queue.filter(
      u => u.socketId !== socket.id
    );

    broadcastMicState(room);
  });

}
