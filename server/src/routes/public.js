import { Router } from "express";
import { upsertClient } from "../services/clients.js";
import { saveUploadedFile } from "../services/files.js";
import { saveContent } from "../services/contents.js";
import { fileUpload, unlinkTemp } from "../middleware/upload.js";
import { asText, isUploadEnabled } from "../utils/paths.js";

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
  fileUpload.single("file")(req, res, (err) => {
    if (err) {
      console.error("POST /file-upload multer", err);
      return res.json({ state: "success" });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!isUploadEnabled(req.body?.isUpload)) {
      unlinkTemp(req.file);
      return res.json({ state: "success" });
    }

    const username = asText(req.body?.username).trim();
    if (!username || !req.file) {
      unlinkTemp(req.file);
      return res.json({ state: "success" });
    }

    await upsertClient(username, req.body?.client_id);
    await saveUploadedFile({
      username,
      clientId: req.body?.client_id,
      folderName: req.body?.folderName,
      fileName: req.body?.fileName,
      filePath: req.body?.filePath,
      tmpFile: req.file,
    });
    return res.json({ state: "success" });
  } catch (err) {
    unlinkTemp(req.file);
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
