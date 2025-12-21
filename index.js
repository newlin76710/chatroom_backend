import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";
import { setupSocket } from "./socket/index.js";

dotenv.config();
const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "50mb" }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", credentials: true } });

setupSocket(io);

app.get("/", (_, res) => res.send("Server OK"));

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Server running on", PORT));
