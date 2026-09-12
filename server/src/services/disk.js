import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { isInsideUploadDir } from "./storage.js";

const HIDDEN = new Set(["_tmp"]);

export function resolveUploadRel(rel = "") {
  const root = path.resolve(config.uploadDir);
  const parts = String(rel || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  const abs = path.resolve(root, ...parts);
  if (!isInsideUploadDir(abs)) {
    const err = new Error("Path is outside uploads");
    err.status = 400;
    throw err;
  }
  return { root, rel: parts.join("/"), abs, parts };
}

export async function listUploadDir(rel = "") {
  const { abs, rel: current } = resolveUploadRel(rel);
  let stat;
  try {
    stat = await fsPromises.stat(abs);
  } catch (err) {
    if (err.code === "ENOENT") {
      const missing = new Error("Folder not found");
      missing.status = 404;
      throw missing;
    }
    throw err;
  }
  if (!stat.isDirectory()) {
    const err = new Error("Not a folder");
    err.status = 400;
    throw err;
  }

  const entries = await fsPromises.readdir(abs, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (HIDDEN.has(entry.name)) continue;
    const full = path.join(abs, entry.name);
    try {
      const info = await fsPromises.stat(full);
      items.push({
        name: entry.name,
        path: current ? `${current}/${entry.name}` : entry.name,
        isDirectory: entry.isDirectory(),
        size: entry.isFile() ? info.size : 0,
        mtime: info.mtime.toISOString(),
      });
    } catch {
      // skip unreadable entries
    }
  }

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: current, items };
}

export async function collectUploadFiles(rel) {
  const { abs, rel: current } = resolveUploadRel(rel);
  let stat;
  try {
    stat = await fsPromises.stat(abs);
  } catch (err) {
    if (err.code === "ENOENT") {
      const missing = new Error("Not found");
      missing.status = 404;
      throw missing;
    }
    throw err;
  }
  if (stat.isFile()) {
    return [
      {
        name: path.basename(abs),
        path: current,
        isDirectory: false,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      },
    ];
  }
  const listing = await listUploadDir(current);
  const files = [];
  for (const item of listing.items) {
    if (item.isDirectory) files.push(...(await collectUploadFiles(item.path)));
    else files.push(item);
  }
  return files;
}

export async function deleteUploadPath(rel) {
  const { abs, rel: current, root } = resolveUploadRel(rel);
  if (abs === root || !current) {
    const err = new Error("Cannot delete the uploads root");
    err.status = 400;
    throw err;
  }
  if (!fs.existsSync(abs)) {
    const err = new Error("Not found");
    err.status = 404;
    throw err;
  }
  await fsPromises.rm(abs, { recursive: true, force: true });
  return { deleted: current };
}

const PREVIEW_MAX = 5 * 1024 * 1024;

export async function readUploadText(rel) {
  const { abs, rel: current } = resolveUploadRel(rel);
  const stat = await fsPromises.stat(abs);
  if (!stat.isFile()) {
    const err = new Error("Not a file");
    err.status = 400;
    throw err;
  }
  if (stat.size > PREVIEW_MAX) {
    const err = new Error("File is too large to preview in the panel. Download it instead.");
    err.status = 413;
    throw err;
  }
  const buf = await fsPromises.readFile(abs);
  if (buf.includes(0)) {
    const err = new Error("This file looks binary. Download it instead.");
    err.status = 415;
    throw err;
  }
  return {
    path: current,
    name: path.basename(abs),
    size: stat.size,
    content: buf.toString("utf8"),
  };
}
