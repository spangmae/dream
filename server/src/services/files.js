import fs from "fs";
import path from "path";
import { supabase } from "../db/supabase.js";
import { config } from "../config.js";
import {
  asText,
  folderKeyFrom,
  numberedFolderKey,
  replaceFolderRoot,
  splitNameAndDir,
  subtreeFilter,
  uploadRootKey,
} from "../utils/paths.js";
import {
  finalDiskPath,
  folderDiskDir,
  isInsideUploadDir,
  moveUpload,
  removeEmptyDirs,
  removeQuiet,
  uniqueFilePath,
} from "./storage.js";

const folderAliases = new Map();
const FOLDER_BATCH_IDLE_MS = 10 * 60 * 1000;

function dirExists(username, folderKey) {
  if (!folderKey) return false;
  const dir = folderDiskDir(username, folderKey);
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function uniqueFolderKey(username, folderName, folderKey) {
  const originalRoot = uploadRootKey(folderName, folderKey);
  if (!originalRoot) return folderKey;

  const mapKey = `${username}::${originalRoot}`;
  const now = Date.now();
  const hit = folderAliases.get(mapKey);
  if (hit && now - hit.lastAt < FOLDER_BATCH_IDLE_MS) {
    hit.lastAt = now;
    return replaceFolderRoot(folderKey, originalRoot, hit.destRoot);
  }

  let destRoot = originalRoot;
  if (dirExists(username, originalRoot)) {
    let n = 2;
    while (dirExists(username, numberedFolderKey(originalRoot, n))) n += 1;
    destRoot = numberedFolderKey(originalRoot, n);
  }
  folderAliases.set(mapKey, { destRoot, lastAt: now });
  return replaceFolderRoot(folderKey, originalRoot, destRoot);
}

export async function saveUploadedFile({
  username,
  folderName,
  fileName,
  filePath,
  tmpFile,
}) {
  const name = asText(username).trim();
  const rawName = asText(fileName).trim() || tmpFile.originalname || "file";
  const storedName = splitNameAndDir(rawName).name || "file";
  const folderKey = uniqueFolderKey(
    name,
    folderName,
    folderKeyFrom(folderName, filePath, rawName)
  );
  const destPath = await uniqueFilePath(finalDiskPath(name, folderKey, storedName));
  await moveUpload(tmpFile.path, destPath);
  const rel = path.relative(config.uploadDir, destPath).split(path.sep).join("/");
  return {
    username: name,
    file_name: path.basename(destPath),
    folder_key: folderKey,
    disk_path: destPath,
    rel_path: rel,
    size_bytes: tmpFile.size || 0,
  };
}

export async function listFiles({ username, folder, q, limit = 500 }) {
  let query = supabase
    .from("files")
    .select(
      "id, username, client_id, folder_name, folder_key, file_name, file_path, size_bytes, mime, created_at, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(Math.min(Number(limit) || 500, 2000));

  if (username) query = query.eq("username", username);
  if (folder !== undefined && folder !== null && folder !== "*") {
    query = query.eq("folder_key", folder);
  }
  if (q) {
    const term = `%${String(q).replace(/[%*,()]/g, "").slice(0, 80)}%`;
    query = query.or(
      `file_name.ilike.${term},file_path.ilike.${term},folder_name.ilike.${term}`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function filesForUser(username) {
  const { data, error } = await supabase
    .from("files")
    .select(
      "id, username, client_id, folder_name, folder_key, file_name, file_path, size_bytes, mime, created_at, updated_at"
    )
    .eq("username", username)
    .order("folder_key", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getFile(id) {
  const { data, error } = await supabase.from("files").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteFile(id) {
  const file = await getFile(id);
  if (!file) return null;
  if (file.disk_path && isInsideUploadDir(file.disk_path)) {
    await removeQuiet(file.disk_path);
    await removeEmptyDirs(path.dirname(file.disk_path));
  }
  const { error } = await supabase.from("files").delete().eq("id", id);
  if (error) throw error;
  return file;
}

export async function deleteFolder(username, folderPath) {
  const { exact, prefix } = subtreeFilter(folderPath);
  const { data: rows, error } = await supabase
    .from("files")
    .select("id, folder_key, disk_path")
    .eq("username", username);
  if (error) throw error;

  const matched = (rows || []).filter((row) => {
    if (!prefix) return row.folder_key === "";
    return row.folder_key === exact || row.folder_key.startsWith(prefix);
  });

  for (const row of matched) {
    await deleteFile(row.id);
  }
  return { deleted: matched.length };
}

export async function recentFiles(limit = 12) {
  const { data, error } = await supabase
    .from("files")
    .select(
      "id, username, file_name, folder_key, size_bytes, created_at, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
