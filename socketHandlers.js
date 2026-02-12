import { songState } from "./song.js";
import { AccessToken } from "livekit-server-sdk";

export function songSocket(io, socket) {

  //////////////////////////////////////////////////////
  // 初始化房間
  //////////////////////////////////////////////////////

  function getRoom(room) {
    if (!songState[room]) {
      songState[room] = {
        queue: [],
        currentSinger: null,
      };
    }
    return songState[room];
  }

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

    io.to(socketId).emit("livekit-token", {
      token: jwt,
      identity
    });
  }

  //////////////////////////////////////////////////////
  // 🔥 叫下一位（核心）
  //////////////////////////////////////////////////////

  async function callNextSinger(room) {
    const state = songState[room];
    if (!state) return;

    while (state.queue.length > 0) {

      const next = state.queue.shift();

      // socket 還活著才叫
      const alive = io.sockets.sockets.get(next.socketId);
      if (!alive) continue;

      state.currentSinger = next;

      broadcastMicState(room);

      await sendLiveKitToken(
        next.socketId,
        room,
        next.name
      );

      return;
    }

    // 沒人排隊
    state.currentSinger = null;
    broadcastMicState(room);
  }

  //////////////////////////////////////////////////////
  // ✅ 加入歌房（不要再叫 joinRoom !!!）
  //////////////////////////////////////////////////////

  socket.on("joinSongRoom", ({ room, name }) => {

    const state = getRoom(room);

    // ⭐ 千萬不要覆蓋 chat 用的 data
    socket.data.song = {
      room,
      name
    };

    socket.join(`song-${room}`);

    broadcastMicState(room);
  });

  //////////////////////////////////////////////////////
  // 排隊 / 搶 mic
  //////////////////////////////////////////////////////

  socket.on("grabMic", async ({ room, singer }) => {

    const state = getRoom(room);

    // 已經在唱
    if (state.currentSinger?.socketId === socket.id)
      return;

    // 已經排隊
    if (state.queue.some(u => u.socketId === socket.id))
      return;

    ////////////////////////////////////////////////////
    // ⭐ 沒人唱 → 直接上
    ////////////////////////////////////////////////////

    if (!state.currentSinger) {

      state.currentSinger = {
        socketId: socket.id,
        name: singer
      };

      broadcastMicState(room);

      await sendLiveKitToken(
        socket.id,
        room,
        singer
      );

      return;
    }

    ////////////////////////////////////////////////////
    // ⭐ 有人唱 → 排隊
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

    // 只有當前 singer 能下麥
    if (state.currentSinger?.socketId !== socket.id)
      return;

    state.currentSinger = null;

    await callNextSinger(room);
  });

  //////////////////////////////////////////////////////
  // 離線（超重要🔥）
  //////////////////////////////////////////////////////

  socket.on("disconnect", async () => {

    const room = socket.data?.song?.room;
    if (!room) return;

    const state = songState[room];
    if (!state) return;

    //////////////////////////////////////////
    // 如果正在唱
    //////////////////////////////////////////

    if (state.currentSinger?.socketId === socket.id) {

      state.currentSinger = null;

      await callNextSinger(room);

      return;
    }

    //////////////////////////////////////////
    // 從排隊移除
    //////////////////////////////////////////

    state.queue = state.queue.filter(
      u => u.socketId !== socket.id
    );

    broadcastMicState(room);
  });

}
