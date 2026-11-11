import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { sanitizeSegment } from "../utils/paths.js";

export function folderDiskDir(username, folderKey) {
  const userSeg = sanitizeSegment(username);
  const folderSegs = String(folderKey || "")
    .split("/")
    .filter(Boolean)
    .map(sanitizeSegment);
  return path.join(config.uploadDir, userSeg, ...folderSegs);
}

export function finalDiskPath(username, folderKey, fileName) {
  return path.join(folderDiskDir(username, folderKey), sanitizeSegment(fileName));
}

export async function uniqueFilePath(destPath) {
  try {
    await fs.access(destPath);
  } catch {
    return destPath;
  }
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let n = 2;
  while (true) {
    const candidate = path.join(dir, `${base} ${n}${ext}`);
    try {
      await fs.access(candidate);
      n += 1;
    } catch {
      return candidate;
    }
  }
}

export async function moveUpload(tmpPath, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  try {
    await fs.rename(tmpPath, destPath);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await fs.copyFile(tmpPath, destPath);
    await fs.unlink(tmpPath);
  }
}

export async function writeTextFile(destPath, content) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, content ?? "", "utf8");
}

export async function removeQuiet(diskPath) {
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

export async function removeEmptyDirs(startPath) {
  let current = path.resolve(startPath);
  const root = path.resolve(config.uploadDir);
  while (current.startsWith(root) && current !== root) {
    try {
      await fs.rmdir(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

export function isInsideUploadDir(diskPath) {
  const resolved = path.resolve(diskPath);
  const root = path.resolve(config.uploadDir);
  return resolved === root || resolved.startsWith(root + path.sep);
}
