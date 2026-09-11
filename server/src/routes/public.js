import { Router } from "express";
import { upsertClient } from "../services/clients.js";
import { saveUploadedFile } from "../services/files.js";
import { saveContent } from "../services/contents.js";
import { fileUpload, unlinkTemp } from "../middleware/upload.js";
import { asText, parseUploadFlag } from "../utils/paths.js";

export const publicRouter = Router();

publicRouter.post("/register", async (req, res) => {
  try {
    const username = req.body?.username;
    const customId = req.body?.customId;
    if (asText(username).trim()) {
      await upsertClient(username, customId);
    }
    return res.status(200).end();
  } catch (err) {
    console.error("POST /register", err);
    return res.status(200).end();
  }
});

publicRouter.post("/file-upload", (req, res, next) => {
  fileUpload.any()(req, res, (err) => {
    if (err) {
      console.error("POST /file-upload multer", err);
      return res.json({ state: "success" });
    }
    next();
  });
}, async (req, res) => {
  const uploaded = Array.isArray(req.files) && req.files.length ? req.files[0] : req.file;
  const flag = parseUploadFlag(req.body);
  const username = asText(req.body?.username).trim();
  const fileName = asText(req.body?.fileName || uploaded?.originalname).trim();
  const folderName = asText(req.body?.folderName);
  const size = uploaded?.size || 0;
  const hasFile = Boolean(uploaded && size > 0);

  try {
    // Folder/metadata pings: isUpload=false and no bytes. Real files are always saved.
    if (!hasFile) {
      unlinkTemp(uploaded);
      console.log(
        `POST /file-upload skip username=${username || "-"} fileName=${fileName || "-"} isUpload=${JSON.stringify(flag.raw)} size=0`
      );
      return res.json({ state: "success" });
    }

    if (!username) {
      unlinkTemp(uploaded);
      console.log(
        `POST /file-upload skip missing-username fileName=${fileName || "-"} isUpload=${JSON.stringify(flag.raw)} size=${size}`
      );
      return res.json({ state: "success" });
    }

    await upsertClient(username, req.body?.client_id);
    const saved = await saveUploadedFile({
      username,
      clientId: req.body?.client_id,
      folderName,
      fileName,
      filePath: req.body?.filePath,
      tmpFile: uploaded,
    });
    console.log(
      `POST /file-upload saved username=${username} fileName=${saved.file_name} folder=${saved.folder_key || "/"} size=${size} disk=${saved.disk_path} isUpload=${JSON.stringify(flag.raw)}`
    );
    try {
      req.app.get("io")?.of("/admin").emit("file_saved", {
        id: saved.id,
        username: saved.username,
        file_name: saved.file_name,
        folder_key: saved.folder_key,
        size_bytes: saved.size_bytes,
      });
    } catch (notifyErr) {
      console.error("file_saved notify", notifyErr);
    }
    return res.json({ state: "success" });
  } catch (err) {
    unlinkTemp(uploaded);
    console.error("POST /file-upload", err);
    return res.json({ state: "success" });
  }
});

publicRouter.post("/content-upload", async (req, res) => {
  try {
    const username = asText(req.body?.username).trim();
    if (username) {
      await upsertClient(username, req.body?.client_id);
      await saveContent({
        username,
        clientId: req.body?.client_id,
        folderName: req.body?.folderName,
        fileName: req.body?.fileName,
        fileContent: req.body?.fileContent,
      });
    }
    return res.status(200).end();
  } catch (err) {
    console.error("POST /content-upload", err);
    return res.status(200).end();
  }
});
