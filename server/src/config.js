import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const uploadDir = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads")
);

export const config = {
  port: Number(process.env.PORT || 5000),
  host: process.env.HOST || "0.0.0.0",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://127.0.0.1:5000",
  uploadDir,
  tmpDir: path.join(uploadDir, "_tmp"),
  maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024 * 1024),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  jwtSecret: required("JWT_SECRET"),
  adminJwtExpires: process.env.ADMIN_JWT_EXPIRES || "7d",
};

fs.mkdirSync(config.tmpDir, { recursive: true });
