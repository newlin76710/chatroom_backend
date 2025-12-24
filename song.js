// song.js
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";

export const songRouter = express.Router();
export const songState = {}; // songState[room] = { queue, currentSinger, scores, scoreTimer }

// ===== 上傳目錄 =====
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, "uploads", "songs");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ===== Multer 設定 =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const singer = req.body.singer || "guest";
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${Date.now()}_${singer}${ext}`);
  }
});
const upload = multer({ storage });

// ===== 上傳錄音 =====
songRouter.post("/upload", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no audio" });

    const filePath = `/songs/${req.file.filename}`;

    // 計算 duration
    let duration = 0;
    // 這裡用 HTML Audio 方式計算，前端也會計算 duration
    // 你也可以用 ffprobe / music-metadata 套件在後端計算

    res.json({ url: filePath, duration });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "upload failed" });
  }
});
