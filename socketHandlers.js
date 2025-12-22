import { songState } from "./song.js";
import { callAISongComment } from "./ai.js";

function getRoomState(room) {
    if (!songState[room]) {
        songState[room] = {
            queue: [],
            currentSinger: null,
            scores: {},
            listeners: [],
            phase: "idle",
            scoreTimer: null,
        };
    }
    return songState[room];
}

export function songSocket(io, socket) {

    // ===== 加入隊列唱歌 =====
    socket.on("joinQueue", ({ room, singer }) => {
        const state = getRoomState(room);
        socket.join(room);

        if (!state.queue.includes(singer) && state.currentSinger !== singer) {
            state.queue.push(singer);
            console.log(`[joinQueue] ${singer} 加入隊列`, state.queue);
        } else {
            console.log(`[joinQueue] ${singer} 已經在隊列或正在唱歌`);
        }

        // 如果沒人在唱歌，自動開始下一位
        if (!state.currentSinger && state.queue.length > 0) {
            const next = state.queue.shift();
            state.currentSinger = next;
            state.phase = "singing";
            if (!state.scores[next]) state.scores[next] = [];

            io.to(room).emit("queueUpdate", { queue: state.queue, current: next });
            io.to(next).emit("update-room-phase", { phase: "singing" });
            io.to(room).except(next).emit("update-room-phase", { phase: "canListen", singer: next });
            console.log(`[queue] ${next} 自動開始唱歌`);
        } else {
            io.to(room).emit("queueUpdate", { queue: state.queue, current: state.currentSinger });
        }
    });
    // start-singing 裡面
    socket.on("start-singing", async ({ room, singer }) => {
        const state = getRoomState(room);
        if (state.currentSinger) return;
        state.currentSinger = singer;
        state.phase = "singing";
        if (!state.scores[singer]) state.scores[singer] = [];

        // 新增: 記錄 producerId
        socket.once("produce", ({ id }) => {
            state.currentProducerId = id;
            console.log(`[produce] ${id} by ${singer}`);
        });

        io.to(room).emit("user-start-singing", { singer });
    });

    // 新增事件：Listener 可以取得當前 active producer
    socket.on("get-active-producers", ({ room }, callback) => {
        const state = getRoomState(room);
        const producers = [];
        if (state.currentProducerId) producers.push(state.currentProducerId);
        callback(producers);
    });

    // ===== 停止唱歌 → 評分開始 =====
    socket.on("stop-singing", ({ room, singer }) => {
        const state = getRoomState(room);
        if (!state || state.currentSinger !== singer) return;

        state.phase = "scoring";
        io.to(room).emit("user-stop-singing", { singer });
        io.to(room).emit("update-room-phase", { phase: "scoring", singer });
        io.to(room).emit("scoring-start");

        if (!state.scores[singer]) state.scores[singer] = [];

        if (state.scoreTimer) clearTimeout(state.scoreTimer);
        state.scoreTimer = setTimeout(() => {
            const scores = state.scores[singer] || [];
            const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
            io.to(room).emit("songResult", { singer, avg, count: scores.length });

            callAISongComment({ singer, avg })
                .then(comment => io.to(room).emit("message", comment))
                .catch(console.error);

            // 清空本輪聽眾
            state.listeners.forEach(id => {
                const sock = io.sockets.sockets.get(id);
                if (sock) sock.emit("listener-left", { listenerId: id });
            });
            state.listeners = [];
            state.currentSinger = null;
            state.phase = "idle";

            // 自動輪到下一位
            if (state.queue.length > 0) {
                const next = state.queue.shift();
                state.currentSinger = next;
                state.phase = "singing";
                if (!state.scores[next]) state.scores[next] = [];

                io.to(room).emit("queueUpdate", { queue: state.queue, current: next });
                io.to(next).emit("update-room-phase", { phase: "singing" });
                io.to(room).except(next).emit("update-room-phase", { phase: "canListen", singer: next });
                console.log(`[queue] ${next} 自動開始唱歌`);
            } else {
                io.to(room).emit("update-room-phase", { phase: "idle" });
            }

            state.scoreTimer = null;
        }, 15000);
    });

    // ===== 評分 =====
    socket.on("scoreSong", ({ room, score }) => {
        const state = getRoomState(room);
        if (!state || !state.currentSinger) return;

        const singer = state.currentSinger;
        if (!state.scores[singer]) state.scores[singer] = [];
        state.scores[singer].push(score);

        socket.emit("scoreAck", { singer, score });
        console.log(`[scoreSong] ${socket.id} 給 ${singer} 評分 ${score}`);
    });

    // ===== 聽眾管理 =====
    socket.on("listener-ready", ({ room, listenerId }) => {
        const state = getRoomState(room);
        if (!state.listeners.includes(listenerId)) state.listeners.push(listenerId);

        const singerId = state.currentSinger;
        if (singerId) io.to(singerId).emit("new-listener", { listenerId });
        io.to(room).emit("update-listeners", { listeners: state.listeners });
    });

    socket.on("stop-listening", ({ room, listenerId }) => {
        const state = getRoomState(room);
        if (!state || !Array.isArray(state.listeners)) return;
        state.listeners = state.listeners.filter(id => id !== listenerId);

        const singerId = state.currentSinger;
        if (singerId) io.to(singerId).emit("listener-left", { listenerId });
        io.to(room).emit("update-listeners", { listeners: state.listeners });
    });

    socket.on("disconnect", () => {
        console.log(`[disconnect] ${socket.id} 離線`);
        for (const room in songState) {
            const state = songState[room];
            if (!state || !Array.isArray(state.listeners)) continue;

            state.listeners = state.listeners.filter(id => id !== socket.id);

            const singerId = state.currentSinger;
            if (singerId) {
                const singerSocket = io.sockets.sockets.get(singerId);
                if (singerSocket) singerSocket.emit("listener-left", { listenerId: socket.id });
            }

            io.to(room).emit("update-listeners", { listeners: state.listeners });
        }
    });
}

export function webrtcHandlers(io, socket) {
    function forward(event, data) {
        if (!data.to) return;
        const target = io.sockets.sockets.get(data.to);
        if (target) target.emit(event, { ...data, from: socket.id });
        console.log(`[WebRTC] ${event} ${socket.id} → ${data.to}`);
    }

    socket.on("webrtc-offer", data => forward("webrtc-offer", data));
    socket.on("webrtc-answer", data => forward("webrtc-answer", data));
    socket.on("webrtc-candidate", data => forward("webrtc-candidate", data));
}

