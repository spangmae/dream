import http from "http";
import express from "express";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import { config } from "./config.js";
import { attachSockets } from "./sockets/hub.js";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin.js";

const app = express();

const corsOrigin =
  config.corsOrigin === "*"
    ? true
    : config.corsOrigin.split(",").map((item) => item.trim());

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "dream-api" });
});

app.get("/", (_req, res) => {
  res.json({
    name: "Dream API",
    health: "/health",
    socket: "/client",
    public: ["/register", "/file-upload", "/content-upload"],
  });
});

app.use(publicRouter);
app.use("/admin", adminRouter);

app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large" });
  }
  console.error(err);
  return res.status(500).json({ error: "Server error" });
});

const server = http.createServer(app);
server.timeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;

const io = new SocketIOServer(server, {
  cors: { origin: corsOrigin, credentials: true },
});
app.set("io", io);
attachSockets(io);

server.listen(config.port, config.host, () => {
  console.log(`Dream API listening on ${config.host}:${config.port}`);
  console.log(`Public base URL: ${config.publicBaseUrl}`);
  console.log(`Upload dir: ${config.uploadDir}`);
});
