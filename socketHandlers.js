// songSocket.js
import { songState } from "./song.js";
import crypto from "crypto";

export function songSocket(io, socket) {

  // ===== 加入隊列 =====
  socket.on("joinQueue", ({ room, singer }) => {
    if (!songState[room]) songState[room] = {
      queue: [],
      currentSinger: null,
      currentSessionId: null,
      singerSocketId: null,
      scores: {},
      scoreTimer: null
    };
    const state = songState[room];

    if (!state.queue.find(u => u.name === singer) && state.currentSinger !== singer) {
      state.queue.push({ name: singer, socketId: socket.id });
    }

    if (!state.currentSinger && state.queue.length > 0) {
      playNextSinger(room, io);
    } else {
      io.to(room).emit("queueUpdate", { queue: state.queue.map(u => u.name), current: state.currentSinger });
    }
  });

  // ===== 錄音完成後通知 =====
  socket.on("songReady", ({ room, singer, url, duration }) => {
    const state = songState[room];
    if (!state) return;

    state.currentSinger = singer;
    if (!state.scores[singer]) state.scores[singer] = [];

    io.to(room).emit("playSong", { url, duration, singer });

    if (state.scoreTimer) clearTimeout(state.scoreTimer);
    state.scoreTimer = setTimeout(() => {
      const scores = state.scores[singer] || [];
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      io.to(room).emit("songResult", { avg, count: scores.length });

      state.currentSinger = null;
      state.currentSessionId = null;
      state.singerSocketId = null;
      state.scoreTimer = null;

      if (state.queue.length > 0) playNextSinger(room, io);

    }, duration * 1000);
  });

  // ===== 評分 =====
  socket.on("scoreSong", ({ room, score }) => {
    const state = songState[room];
    if (!state || !state.currentSinger) return;
    const singer = state.currentSinger;
    if (!state.scores[singer]) state.scores[singer] = [];
    state.scores[singer].push(score);
  });

  // ===== 離開隊列 =====
  socket.on("leaveQueue", ({ room, singer }) => {
    const state = songState[room];
    if (!state) return;

    state.queue = state.queue.filter(u => u.name !== singer);

    if (state.currentSinger === singer) {
      if (state.scoreTimer) clearTimeout(state.scoreTimer);
      state.currentSinger = null;
      state.currentSessionId = null;
      state.singerSocketId = null;

      if (state.queue.length > 0) playNextSinger(room, io);
      else io.to(room).emit("queueUpdate", { queue: state.queue.map(u => u.name), current: null });
    } else {
      io.to(room).emit("queueUpdate", { queue: state.queue.map(u => u.name), current: state.currentSinger });
    }
  });

  // ===== 斷線清理 =====
  socket.on("disconnect", () => {
    for (const room in songState) {
      const state = songState[room];
      if (!state) continue;

      state.queue = state.queue.filter(u => u.socketId !== socket.id);

      if (state.currentSinger && state.singerSocketId === socket.id) {
        if (state.scoreTimer) clearTimeout(state.scoreTimer);
        state.currentSinger = null;
        state.currentSessionId = null;
        state.singerSocketId = null;

        if (state.queue.length > 0) playNextSinger(room, io);
        else io.to(room).emit("queueUpdate", { queue: state.queue.map(u => u.name), current: null });
      }
    }
  });

  // ===== WebRTC OFFER =====
  socket.on("webrtc-offer", ({ room, offer, singer, sessionId }) => {
    const state = songState[room];
    if (!state || state.currentSessionId !== sessionId || state.singerSocketId !== socket.id) return;
    socket.to(room).emit("webrtc-offer", { offer, singer, sessionId });
  });

  // ===== WebRTC ANSWER =====
  socket.on("webrtc-answer", ({ room, answer, sessionId }) => {
    const state = songState[room];
    if (!state || state.currentSessionId !== sessionId) return;
    io.to(state.singerSocketId).emit("webrtc-answer", { answer, sessionId });
  });

  // ===== ICE =====
  socket.on("webrtc-ice", ({ room, candidate, sessionId }) => {
    const state = songState[room];
    if (!state || state.currentSessionId !== sessionId) return;
    socket.to(room).emit("webrtc-ice", { candidate, sessionId });
  });

  // ===== STOP =====
  socket.on("webrtc-stop", ({ room }) => {
    const state = songState[room];
    if (!state) return;
    state.currentSessionId = null;
    state.singerSocketId = null;
    socket.to(room).emit("webrtc-stop");
  });
}

// ===== 播放下一位歌手 =====
function playNextSinger(room, io) {
  const state = songState[room];
  if (!state || !state.queue.length) return;

  const nextSinger = state.queue.shift();
  state.currentSinger = nextSinger.name;
  state.currentSessionId = crypto.randomUUID();
  state.singerSocketId = nextSinger.socketId;

  io.to(room).emit("queueUpdate", { queue: state.queue.map(u => u.name), current: nextSinger.name });

  // 通知歌手
  io.to(nextSinger.socketId).emit("update-room-phase", {
    phase: "singing",
    singer: nextSinger.name,
    sessionId: state.currentSessionId
  });

  // 通知其他人
  state.queue.forEach(u => {
    io.to(u.socketId).emit("update-room-phase", {
      phase: "listening",
      singer: nextSinger.name,
      sessionId: state.currentSessionId
    });
  });
}
