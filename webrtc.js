export function webrtcHandlers(io, socket){
  // 前端發 offer
  socket.on("webrtc-offer", ({ room, offer, to, sender }) => {
    if(to){
      const target = io.sockets.sockets.get(to);
      if(target) target.emit("webrtc-offer", { offer, sender });
    } else socket.to(room).emit("webrtc-offer", { offer, sender });
  });

  // 接收 Answer
  socket.on("webrtc-answer", ({ room, answer, to }) => {
    if(!to) return;
    const target = io.sockets.sockets.get(to);
    if(target) target.emit("webrtc-answer", { answer, sender: socket.data.name });
  });

  // ICE Candidate
  socket.on("webrtc-candidate", ({ room, candidate, to }) => {
    if(to){
      const target = io.sockets.sockets.get(to);
      if(target) target.emit("webrtc-candidate", { candidate, sender: socket.data.name });
    } else socket.to(room).emit("webrtc-candidate", { candidate, sender: socket.data.name });
  });
}
