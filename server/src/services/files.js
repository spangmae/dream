import path from "path";
import { supabase } from "../db/supabase.js";
import { asText, folderKeyFrom, subtreeFilter } from "../utils/paths.js";
import {
  finalDiskPath,
  isInsideUploadDir,
  moveUpload,
  removeEmptyDirs,
  removeQuiet,
} from "./storage.js";

async function findFile(username, folderKey, fileName) {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("username", username)
    .eq("folder_key", folderKey)
    .eq("file_name", fileName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveUploadedFile({
  username,
  clientId,
  folderName,
  fileName,
  filePath,
  tmpFile,
}) {
  const name = asText(username).trim();
  const storedName = asText(fileName).trim() || tmpFile.originalname || "file";
  const folderKey = folderKeyFrom(folderName, filePath);
  const destPath = finalDiskPath(name, folderKey, storedName);
  const existing = await findFile(name, folderKey, storedName);

  await moveUpload(tmpFile.path, destPath);

  const row = {
    username: name,
    client_id: asText(clientId),
    folder_name: asText(folderName),
    folder_key: folderKey,
    file_name: storedName,
    file_path: asText(filePath),
    disk_path: destPath,
    size_bytes: tmpFile.size || 0,
    mime: tmpFile.mimetype || null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    if (existing.disk_path && existing.disk_path !== destPath) {
      await removeQuiet(existing.disk_path);
      await removeEmptyDirs(path.dirname(existing.disk_path));
    }
    const { data, error } = await supabase
      .from("files")
      .update(row)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from("files").insert(row).select().single();
  if (error) throw error;
  return data;
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
