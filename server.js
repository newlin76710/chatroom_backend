// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import fetch from "node-fetch"; // Node 18+ 可直接用 fetch
import { AccessToken } from "livekit-server-sdk"; // 舊版本 v2.x 用 addGrant

import { pool } from "./db.js";
import { authRouter } from "./auth.js";
import { aiRouter } from "./ai.js";
import { songRouter } from "./song.js";
import { chatHandlers } from "./chat.js";
import { songSocket } from "./socketHandlers.js";
import { songState } from "./song.js"; // 判斷誰是歌手

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://boygirl.ek21.com",
      "https://windsong.ek21.com",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket"],
});

// ===== Upload dir =====
const __dirname = path.resolve();
const uploadDir = path.join(__dirname, "uploads", "songs");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ===== Middleware =====
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://boygirl.ek21.com",
      "https://windsong.ek21.com",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/songs", express.static(uploadDir));

// ===== Routes =====
app.use("/auth", authRouter);
app.use("/ai", aiRouter);
app.use("/song", songRouter);

// ===== LiveKit Token API =====
app.get("/livekit-token", async (req, res) => {
  const { room, userId } = req.query;
  if (!room) return res.status(400).json({ error: "missing room" });

  // 用 socket.id 當身份，如果前端沒有傳 userId 就生成 guest
  const identity = userId || "guest-" + Math.random().toString(36).substring(2, 8);

  const state = songState[room];
  const isSinger = state?.currentSingerSocketId === identity;

  try {
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity, ttl: "10m" } // 10 分鐘
    );

    at.addGrant({
      room: room,
      roomJoin: true,
      canPublish: isSinger,  // 只有輪到唱的人能發送音訊
      canSubscribe: true,    // 所有人都能收聽
      canPublishData: true,  // data channel
    });

    const token = await at.toJwt();

    console.log(`[LiveKit Token] ${identity} in room ${room} as ${isSinger ? "singer" : "listener"}`);

    res.json({
      token,
      identity,
      role: isSinger ? "singer" : "listener",
    });
  } catch (err) {
    console.error("[LiveKit Token] Error:", err);
    res.status(500).json({ error: "LiveKit token generation failed" });
  }
});

// ===== Socket.IO =====
io.on("connection", (socket) => {
  console.log(`[socket] ${socket.id} connected`);

  // 聊天 / AI
  chatHandlers(io, socket);

  // 唱歌 / queue / 評分
  songSocket(io, socket);

  socket.on("disconnect", () => {
    console.log(`[socket] ${socket.id} disconnected`);
  });
});

// ===== Heartbeat for Render =====
const HEARTBEAT_INTERVAL = 1 * 60 * 1000; // 每 1 分鐘
setInterval(async () => {
  try {
    const url = process.env.SELF_URL || `http://localhost:${process.env.PORT || 10000}/`;
    const res = await fetch(url);
    console.log(`[Heartbeat] ${new Date().toISOString()} - Status: ${res.status}`);
  } catch (err) {
    console.error("[Heartbeat] Error:", err.message);
  }
}, HEARTBEAT_INTERVAL);

// ===== Start server =====
const port = process.env.PORT || 10000;
server.listen(port, () => console.log(`🚀 Server running on port ${port}`));
