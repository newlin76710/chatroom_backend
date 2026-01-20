import { songState } from "./song.js";

export function songSocket(io, socket) {

  // ===== 廣播當前隊列與拿麥克風的人 =====
  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;
    io.to(room).emit("micStateUpdate", {
      queue: state.queue.map(u => u.name),
      currentSinger: state.currentSinger || null
    });
  }

  // ===== 加入隊列 =====
  socket.on("joinQueue", ({ room, singer }) => {
    if (!songState[room]) songState[room] = { queue: [], currentSinger: null, scores: {}, scoreTimer: null };
    const state = songState[room];

    // 檢查是否已經在隊列或正在唱
    if (!state.queue.find(u => u.name === singer) && state.currentSinger !== singer) {
      state.queue.push({ name: singer, socketId: socket.id });
    }

    // 如果沒人在唱歌，自動下一位
    if (!state.currentSinger && state.queue.length > 0) {
      playNextSinger(room, io);
    }

    broadcastMicState(room);
  });

  // ===== 離開隊列 =====
  socket.on("leaveQueue", ({ room, singer }) => {
    const state = songState[room];
    if (!state) return;

    state.queue = state.queue.filter(u => u.name !== singer);

    if (state.currentSinger === singer) {
      if (state.scoreTimer) clearTimeout(state.scoreTimer);
      state.currentSinger = null;
      if (state.queue.length > 0) playNextSinger(room, io);
      else broadcastMicState(room);
    } else {
      broadcastMicState(room);
    }
  });

  // ===== 錄音完成後通知 =====
  socket.on("songReady", ({ room, singer, url, duration }) => {
    const state = songState[room];
    if (!state) return;

    state.currentSinger = singer;
    state.scores[singer] = [];

    io.to(room).emit("playSong", { url, duration, singer });

    if (state.scoreTimer) clearTimeout(state.scoreTimer);
    state.scoreTimer = setTimeout(() => {
      const scores = state.scores[singer] || [];
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      io.to(room).emit("songResult", { avg, count: scores.length });

      state.currentSinger = null;
      state.scoreTimer = null;

      if (state.queue.length > 0) playNextSinger(room, io);
      else broadcastMicState(room);
    }, duration * 1000);

    broadcastMicState(room);
  });

  // ===== 評分 =====
  socket.on("scoreSong", ({ room, score }) => {
    const state = songState[room];
    if (!state || !state.currentSinger) return;
    const singer = state.currentSinger;
    if (!state.scores[singer]) state.scores[singer] = [];
    state.scores[singer].push(score);
  });

  // ===== 斷線清理 =====
  socket.on("disconnect", () => {
    for (const room in songState) {
      const state = songState[room];
      if (!state) continue;

      // 移除隊列
      state.queue = state.queue.filter(u => u.socketId !== socket.id);

      // 如果正在唱的人斷線
      if (state.currentSingerSocketId === socket.id) {
        if (state.scoreTimer) clearTimeout(state.scoreTimer);
        state.currentSinger = null;
        if (state.queue.length > 0) playNextSinger(room, io);
        else broadcastMicState(room);
      } else {
        broadcastMicState(room);
      }
    }
  });

  // ===== WebRTC =====
  socket.on("webrtc-offer", ({ room, offer, singer }) => {
    socket.to(room).emit("webrtc-offer", { offer, singer });
  });
  socket.on("webrtc-answer", ({ room, answer }) => {
    socket.to(room).emit("webrtc-answer", { answer });
  });
  socket.on("webrtc-ice", ({ room, candidate }) => {
    socket.to(room).emit("webrtc-ice", { candidate });
  });
  socket.on("webrtc-stop", ({ room }) => {
    socket.to(room).emit("webrtc-stop");
  });

  // ===== 播放下一位歌手 =====
  function playNextSinger(room, io) {
    const state = songState[room];
    if (!state || !state.queue.length) return;

    const nextSinger = state.queue.shift();
    state.currentSinger = nextSinger.name;
    state.currentSingerSocketId = nextSinger.socketId;

    broadcastMicState(room);

    // 通知下一位唱歌
    io.to(nextSinger.socketId).emit("update-room-phase", { phase: "singing", singer: nextSinger.name });

    // 其他人 listening
    state.queue.forEach(u => {
      io.to(u.socketId).emit("update-room-phase", { phase: "listening", singer: nextSinger.name });
    });
  }
}
