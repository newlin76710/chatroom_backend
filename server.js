// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import fetch from "node-fetch"; // Node 18+ 可直接用 fetch
import { AccessToken, RoomGrant } from "livekit-server-sdk"; // ✅ 新版 SDK

import { pool } from "./db.js";
import { authRouter } from "./auth.js";
import { aiRouter } from "./ai.js";
import { songRouter } from "./song.js";
import { chatHandlers } from "./chat.js";
import { songSocket } from "./socketHandlers.js";
import { songState } from "./song.js";

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
app.get("/livekit-token", (req, res) => {
  const { room, name } = req.query;

  if (!room || !name) {
    return res.status(400).json({ error: "missing room or name" });
  }

  const state = songState[room];
  const isSinger = state && state.currentSinger === name;

  // 產生 token
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: name, ttl: 600 } // 10 分鐘
  );

  const grant = new RoomGrant({ room });
  grant.roomJoin = true;
  grant.canPublish = isSinger; // 🎤 只有輪到的人能開 mic
  grant.canSubscribe = true;    // 聽眾都能聽
  grant.canPublishData = true;  // data channel
  at.addGrant(grant);

  res.json({
    token: at.toJwt(),              // ✅ 必須是字串 JWT
    role: isSinger ? "singer" : "listener",
  });
});

// ===== Socket.IO =====
io.on("connection", (socket) => {
  console.log(`[socket] ${socket.id} connected`);

  // 聊天 / AI
  chatHandlers(io, socket);

  // 唱歌 / 評分
  songSocket(io, socket);

  socket.on("disconnect", () => {
    console.log(`[socket] ${socket.id} disconnected`);
  });
});

// ===== Heartbeat for Render =====
const HEARTBEAT_INTERVAL = 60 * 1000; // 1 分鐘
setInterval(async () => {
  try {
    const url =
      process.env.SELF_URL || `http://localhost:${process.env.PORT || 10000}/`;
    const res = await fetch(url);
    console.log(`[Heartbeat] ${new Date().toISOString()} - Status: ${res.status}`);
  } catch (err) {
    console.error("[Heartbeat] Error:", err.message);
  }
}, HEARTBEAT_INTERVAL);

// ===== Start server =====
const port = process.env.PORT || 10000;
server.listen(port, () => console.log(`🚀 Server running on port ${port}`));
