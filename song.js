import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";

export const songRouter = express.Router();
export const songState = {}; // songState[room] = { queue, currentSinger, scores, scoreTimer }

const __dirname = new URL('.', import.meta.url).pathname;
const uploadDir = path.join(__dirname, "uploads", "songs");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// multer 設定：存檔到 uploads/songs
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const singer = req.body.singer || "guest";
    cb(null, `${Date.now()}_${singer}.webm`);
  }
});
const upload = multer({ storage });

// 上傳錄音
songRouter.post("/upload", upload.single("audio"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "no audio" });

    // 生成可在前端播放的 URL
    const url = `/songs/${file.filename}`;

    res.json({ url, duration: 0 }); // duration 前端用 getBlobDuration(blob) 取得
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "upload failed" });
  }
});
