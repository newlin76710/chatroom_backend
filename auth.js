import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

export const authRouter = express.Router();

// 訪客登入
authRouter.post("/guest", async (req, res) => {
  try {
    const { gender } = req.body;
    const safeGender = gender === "男" ? "男" : "女";

    const guestName = "訪客" + Math.floor(Math.random() * 10000);
    const now = new Date();
    const guestToken = crypto.randomUUID();
    const randomPassword = crypto.randomBytes(8).toString("hex"); 
    const level = 1;
    const exp = 0;

    const result = await pool.query(
      `INSERT INTO users (username, password, gender, last_login, account_type, level, exp)
       VALUES ($1, $2, $3, $4, 'guest', $5, $6)
       RETURNING id, username, gender, level, exp`,
      [guestName, randomPassword, safeGender, now, level, exp]
    );

    const guest = result.rows[0];
    res.json({ guestToken, name: guest.username, gender: guest.gender, level: guest.level, exp: guest.exp, last_login: now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "訪客登入失敗" });
  }
});

// 註冊
authRouter.post("/register", async (req, res) => {
  try {
    const { username, password, gender, phone, email, avatar } = req.body;
    if (!username || !password) return res.status(400).json({ error: "缺少帳號或密碼" });

    const exist = await pool.query(`SELECT id FROM users WHERE username = $1`, [username]);
    if (exist.rowCount > 0) return res.status(400).json({ error: "帳號已存在" });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password, gender, phone, email, avatar, level, exp)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 0)
       RETURNING id, username, gender, avatar, level, exp`,
      [username, hash, gender === "男" ? "男" : "女", phone || null, email || null, avatar || null]
    );

    res.json({ message: "註冊成功", user: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "註冊失敗" });
  }
});

// 登入
authRouter.post("/login", async (req, res) => {
  try {
    const { username, password, gender } = req.body;
    if (!username || !password) return res.status(400).json({ error: "缺少帳號或密碼" });

    const result = await pool.query(
      `SELECT id, username, password, level, exp, avatar FROM users WHERE username=$1`,
      [username]
    );

    if (result.rowCount === 0) return res.status(400).json({ error: "帳號不存在" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "密碼錯誤" });

    const safeGender = gender === "男" ? "男" : "女";
    const now = new Date();
    await pool.query(`UPDATE users SET gender=$1, last_login=$2, account_type='account' WHERE id=$3`, [safeGender, now, user.id]);

    const token = crypto.randomUUID();
    res.json({ token, name: user.username, level: user.level, exp: user.exp, gender: safeGender, avatar: user.avatar, last_login: now });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "登入失敗" });
  }
});
