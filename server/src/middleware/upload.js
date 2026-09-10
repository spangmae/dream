import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { config } from "../config.js";

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, config.tmpDir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || "").slice(0, 20);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

export const fileUpload = multer({
  storage,
  limits: { fileSize: config.maxFileSizeBytes, files: 1 },
});

export function unlinkTemp(file) {
  if (!file?.path) return;
  fs.unlink(file.path, () => {});
}
