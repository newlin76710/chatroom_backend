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
  // 廣播麥序（只送前端需要的）
  //////////////////////////////////////////////////////
  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;

    io.to(`song-${room}`).emit("micStateUpdate", {
      currentSinger: state.currentSinger
        ? state.currentSinger.name
        : null,
      queue: state.queue.map(u => u.name),
    });
  }

  //////////////////////////////////////////////////////
  // 發 LiveKit Token
  //////////////////////////////////////////////////////
  async function sendLiveKitToken(socketId, room, name) {
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
    });

    io.to(socketId).emit("livekit-token", {
      token: await token.toJwt(),
      identity: name,
    });
  }

  //////////////////////////////////////////////////////
  // 叫下一位
  //////////////////////////////////////////////////////
  async function callNextSinger(room) {
    const state = songState[room];
    if (!state) return;

    while (state.queue.length > 0) {
      const next = state.queue.shift();

      // socket 不存在就跳過
      if (!io.sockets.sockets.get(next.socketId)) continue;

      state.currentSinger = next;
      broadcastMicState(room);

      await sendLiveKitToken(
        next.socketId,
        room,
        next.name
      );
      return;
    }

    // 沒人
    state.currentSinger = null;
    broadcastMicState(room);
  }

  //////////////////////////////////////////////////////
  // 加入歌房（與 chat.js 分離）
  //////////////////////////////////////////////////////
  socket.on("joinSongRoom", ({ room, name }) => {
    getRoom(room);

    socket.data.song = { room, name };
    socket.join(`song-${room}`);

    broadcastMicState(room);
  });

  //////////////////////////////////////////////////////
  // 上 mic / 排隊
  //////////////////////////////////////////////////////
  socket.on("grabMic", async ({ room, singer }) => {
    const state = getRoom(room);

    // 已在唱 or 已排隊
    if (
      state.currentSinger?.socketId === socket.id ||
      state.queue.some(u => u.socketId === socket.id)
    ) return;

    // 沒人唱 → 直接上
    if (!state.currentSinger) {
      state.currentSinger = {
        socketId: socket.id,
        name: singer,
      };

      broadcastMicState(room);
      await sendLiveKitToken(socket.id, room, singer);
      return;
    }

    // 有人唱 → 排隊
    state.queue.push({
      socketId: socket.id,
      name: singer,
    });

    broadcastMicState(room);
  });

  //////////////////////////////////////////////////////
  // 下 mic
  //////////////////////////////////////////////////////
  socket.on("stopSing", async ({ room }) => {
    const state = songState[room];
    if (!state) return;

    if (state.currentSinger?.socketId !== socket.id)
      return;

    state.currentSinger = null;
    await callNextSinger(room);
  });

  //////////////////////////////////////////////////////
  // 離線處理（超重要）
  //////////////////////////////////////////////////////
  socket.on("disconnect", async () => {
    const room = socket.data?.song?.room;
    if (!room) return;

    const state = songState[room];
    if (!state) return;

    // 正在唱 → 直接換下一位
    if (state.currentSinger?.socketId === socket.id) {
      state.currentSinger = null;
      await callNextSinger(room);
      return;
    }

    // 排隊中 → 移除
    state.queue = state.queue.filter(
      u => u.socketId !== socket.id
    );

    broadcastMicState(room);
  });
}
