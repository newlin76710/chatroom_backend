import { songState } from "./song.js";
import { callAISongComment } from "./ai.js";

export function songSocket(io, socket) {

  // 開始唱歌
  socket.on("start-singing", ({ room, singer }) => {
    if (!songState[room]) songState[room] = { queue: [], currentSinger: null, scores: {}, scoreTimer: null };
    const state = songState[room];
    if (state.currentSinger) return;

    state.currentSinger = singer;
    state.scores[singer] = [];
    socket.to(room).emit("user-start-singing", { singer });
    console.log("✅ start-singing emitted public");
  });

  // 停止唱歌
  socket.on("stop-singing", ({ room, singer }) => {
    const state = songState[room];
    if (!state || state.currentSinger !== singer) return;

    state.currentSinger = null;
    socket.to(room).emit("user-stop-singing", { singer });
    console.log("🛑 stop-singing emitted public");

    if (state.scoreTimer) clearTimeout(state.scoreTimer);
    state.scoreTimer = setTimeout(async () => {
      const scores = state.scores[singer] || [];
      const avg = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 0;

      io.to(room).emit("songResult", { singer, avg, count: scores.length });

      // AI 歌評
      const aiComment = await callAISongComment({ singer, avg });
      io.to(room).emit("message", aiComment);

      // 播放下一位
      if (state.queue.length) {
        const next = state.queue.shift();
        io.to(room).emit("next-singer", { singer: next });
      }
    }, 15000);
  });

  // 接收評分
  socket.on("scoreSong", ({ room, score }) => {
    const state = songState[room];
    if (!state || !state.currentSinger) return;
    const singer = state.currentSinger;
    if (!state.scores[singer]) state.scores[singer] = [];
    state.scores[singer].push(score);
  });
}
