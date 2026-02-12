import { songState } from "./song.js";
import { AccessToken } from "livekit-server-sdk";

export function songSocket(io, socket) {

  //////////////////////////////////////////////////////
  // 取得 / 初始化房間
  //////////////////////////////////////////////////////
  function getRoom(room) {
    if (!songState[room]) {
      songState[room] = {
        queue: [],
        currentSinger: null, // { socketId, name }
      };
    }
    return songState[room];
  }

  //////////////////////////////////////////////////////
  // 廣播麥序（前端用 socketId 判斷自己）
  //////////////////////////////////////////////////////
  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;

    console.log(`[broadcastMicState] Room: ${room}`);
    console.log("  currentSinger:", state.currentSinger);
    console.log("  queue:", state.queue);

    io.to(`song-${room}`).emit("micStateUpdate", {
      currentSinger: state.currentSinger || null, // { socketId, name } or null
      queue: state.queue.map(u => ({ socketId: u.socketId, name: u.name })),
    });
  }

  //////////////////////////////////////////////////////
  // 發 LiveKit Token
  //////////////////////////////////////////////////////
  async function sendLiveKitToken(socketId, room, name) {
    console.log(`[sendLiveKitToken] to ${name} (${socketId}) in room ${room}`);

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: name, ttl: 600 }
    );

    token.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    io.to(socketId).emit("livekit-token", {
      token: jwt,
      identity: name,
    });
  }

  //////////////////////////////////////////////////////
  // 叫下一位上麥
  //////////////////////////////////////////////////////
  async function callNextSinger(room) {
    const state = getRoom(room);

    console.log(`[callNextSinger] Room: ${room}`);
    console.log("  queue before:", state.queue);

    while (state.queue.length > 0) {
      const next = state.queue.shift();

      const alive = io.sockets.sockets.get(next.socketId);
      console.log(`  next in queue: ${next.name} (${next.socketId}), alive:`, !!alive);
      if (!alive) continue;

      state.currentSinger = next;
      broadcastMicState(room);

      await sendLiveKitToken(next.socketId, room, next.name);
      return;
    }

    state.currentSinger = null;
    broadcastMicState(room);
    console.log("  no one in queue, currentSinger set to null");
  }

  //////////////////////////////////////////////////////
  // 加入歌房
  //////////////////////////////////////////////////////
  socket.on("joinSongRoom", ({ room, name }) => {
    getRoom(room);
    socket.data.song = { room, name };
    socket.join(`song-${room}`);

    console.log(`[joinSongRoom] ${name} joined room ${room}`);
    broadcastMicState(room);
  });

  //////////////////////////////////////////////////////
  // 上麥 / 排隊
  //////////////////////////////////////////////////////
  socket.on("grabMic", async ({ room, singer }) => {
    const state = getRoom(room);

    console.log(`[grabMic] ${singer} (${socket.id}) in room ${room}`);
    console.log("  currentSinger:", state.currentSinger);
    console.log("  queue before:", state.queue);

    if (
      state.currentSinger?.socketId === socket.id ||
      state.queue.some(u => u.socketId === socket.id)
    ) {
      console.log("  already singing or in queue, ignoring grabMic");
      return;
    }

    if (!state.currentSinger) {
      state.currentSinger = { socketId: socket.id, name: singer };
      broadcastMicState(room);
      await sendLiveKitToken(socket.id, room, singer);
      console.log("  no one singing, grabMic → now singing");
      return;
    }

    state.queue.push({ socketId: socket.id, name: singer });
    broadcastMicState(room);
    console.log("  someone is singing, added to queue");
  });

  //////////////////////////////////////////////////////
  // 下麥
  //////////////////////////////////////////////////////
  socket.on("stopSing", async ({ room }) => {
    const state = getRoom(room);
    if (!state) return;

    console.log(`[stopSing] ${socket.data?.song?.name} (${socket.id}) in room ${room}`);
    console.log("  currentSinger before:", state.currentSinger);

    if (state.currentSinger?.socketId !== socket.id) {
      console.log("  not the current singer, ignoring stopSing");
      return;
    }

    state.currentSinger = null;
    broadcastMicState(room);
    await callNextSinger(room);
    console.log("  stopped singing, called next singer");
  });

  //////////////////////////////////////////////////////
  // 離線處理
  //////////////////////////////////////////////////////
  socket.on("disconnect", async () => {
    const room = socket.data?.song?.room;
    if (!room) return;

    const state = getRoom(room);
    console.log(`[disconnect] ${socket.id} in room ${room}`);
    console.log("  currentSinger before:", state.currentSinger);
    console.log("  queue before:", state.queue);

    if (state.currentSinger?.socketId === socket.id) {
      state.currentSinger = null;
      await callNextSinger(room);
      return;
    }

    state.queue = state.queue.filter(u => u.socketId !== socket.id);
    broadcastMicState(room);
    console.log("  removed from queue, broadcast updated state");
  });
}
