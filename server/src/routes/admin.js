import fs from "fs";
import path from "path";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { supabase } from "../db/supabase.js";
import { requireAdmin, signAdminToken } from "../middleware/auth.js";
import { getStats } from "../services/stats.js";
import { getClient, listClients } from "../services/clients.js";
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
    const clients = await listClients();
    return res.json({ clients });
  } catch (err) {
    console.error("GET /admin/clients", err);
    return res.status(500).json({ error: "Failed to load clients" });
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
