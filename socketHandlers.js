import { songState } from "./song.js";
import { callAISongComment } from "./ai.js";

export function songSocket(io, socket) {

  // --- 開始唱歌 ---
  socket.on("start-singing", ({ room, singer }) => {
    if (!songState[room]) songState[room] = { queue: [], currentSinger: null, scores: {}, scoreTimer: null };
    const state = songState[room];

    if (state.currentSinger) return; // 已有人在唱

    state.currentSinger = singer;
    if (!state.scores[singer]) state.scores[singer] = [];

    socket.to(room).emit("user-start-singing", { singer });
    console.log("✅ start-singing emitted public");
  });

  // --- 停止唱歌 / 自動下一位 ---
  socket.on("stop-singing", ({ room, singer }) => {
    if (!songState[room]) return;
    const state = songState[room];

    if (state.currentSinger !== singer) return;

    state.currentSinger = null;
    socket.to(room).emit("user-stop-singing", { singer });
    console.log("🛑 stop-singing emitted public");

    if (state.scoreTimer) clearTimeout(state.scoreTimer);

    state.scoreTimer = setTimeout(async () => {
      const scores = state.scores[singer] || [];
      const avg = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 0;

      io.to(room).emit("songResult", { singer, avg, count: scores.length });

      // AI 歌評
      try {
        const aiComment = await callAISongComment({ singer, avg });
        io.to(room).emit("message", aiComment);
      } catch(err) {
        console.error("AI song comment error:", err);
      }

      // 播放下一位
      if (!Array.isArray(state.queue)) state.queue = [];
      if (state.queue.length > 0) {
        const next = state.queue.shift();
        state.currentSinger = next;
        state.scores[next] = state.scores[next] || [];
        io.to(room).emit("next-singer", { singer: next });
        io.to(room).emit("user-start-singing", { singer: next });

        // 設定下一位計時器
        state.scoreTimer = setTimeout(() => {
          socket.emit("stop-singing", { room, singer: next });
        }, 15000);
      } else {
        state.currentSinger = null;
        io.to(room).emit("updateSingingStatus", { currentSinger: null });
      }
    }, 15000); // 停止後延遲 15 秒
  });

  // --- 接收評分 ---
  socket.on("scoreSong", ({ room, score }) => {
    if (!songState[room] || !songState[room].currentSinger) return;
    const singer = songState[room].currentSinger;

    if (!songState[room].scores[singer]) songState[room].scores[singer] = [];
    songState[room].scores[singer].push(score);
  });
}
