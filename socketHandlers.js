import { songState } from "./song.js";

export function songSocket(io, socket) {

  function broadcastMicState(room) {
    const state = songState[room];
    if (!state) return;
    io.to(room).emit("micStateUpdate", {
      queue: state.queue.map(u => u.name),
      currentSinger: state.currentSinger || null
    });
  }

  function playNextSinger(room) {
    const state = songState[room];
    if (!state || !state.queue.length) return;

    const nextSinger = state.queue.shift();
    state.currentSinger = nextSinger.name;
    state.currentSingerSocketId = nextSinger.socketId;

    broadcastMicState(room);

    // 通知下一位開始唱
    io.to(nextSinger.socketId).emit("update-room-phase", { phase: "singing", singer: nextSinger.name });
  }

  socket.on("joinQueue", ({ room, singer }) => {
    if (!songState[room]) songState[room] = { queue: [], currentSinger: null, currentSingerSocketId: null };
    const state = songState[room];

    if (!state.queue.find(u => u.name === singer) && state.currentSinger !== singer) {
      state.queue.push({ name: singer, socketId: socket.id });
    }

    if (!state.currentSinger) playNextSinger(room);
    else broadcastMicState(room);
  });

  socket.on("leaveQueue", ({ room, singer }) => {
    const state = songState[room];
    if (!state) return;

    state.queue = state.queue.filter(u => u.name !== singer);

    if (state.currentSinger === singer) {
      state.currentSinger = null;
      state.currentSingerSocketId = null;
      if (state.queue.length > 0) playNextSinger(room);
      else broadcastMicState(room);
    } else {
      broadcastMicState(room);
    }
  });

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

  // WebRTC 轉發
  socket.on("webrtc-offer", ({ room, offer, singer }) => socket.to(room).emit("webrtc-offer", { offer, singer }));
  socket.on("webrtc-answer", ({ room, answer }) => socket.to(room).emit("webrtc-answer", { answer }));
  socket.on("webrtc-ice", ({ room, candidate }) => socket.to(room).emit("webrtc-ice", { candidate }));
  socket.on("webrtc-stop", ({ room }) => socket.to(room).emit("webrtc-stop"));
}
