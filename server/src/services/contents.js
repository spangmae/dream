import path from "path";
import { supabase } from "../db/supabase.js";
import { asText, folderKeyFrom, subtreeFilter } from "../utils/paths.js";
import {
  finalDiskPath,
  isInsideUploadDir,
  removeEmptyDirs,
  removeQuiet,
  writeTextFile,
} from "./storage.js";

async function findContent(username, folderKey, fileName) {
  const { data, error } = await supabase
    .from("contents")
    .select("*")
    .eq("username", username)
    .eq("folder_key", folderKey)
    .eq("file_name", fileName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveContent({ username, clientId, folderName, fileName, fileContent }) {
  const name = asText(username).trim();
  const storedName = asText(fileName).trim() || "content.txt";
  const folderKey = folderKeyFrom(folderName, "");
  const destPath = finalDiskPath(name, folderKey, storedName);
  const existing = await findContent(name, folderKey, storedName);
  const text = asText(fileContent);

  await writeTextFile(destPath, text);

  const row = {
    username: name,
    client_id: asText(clientId),
    folder_name: asText(folderName),
    folder_key: folderKey,
    file_name: storedName,
    file_content: text,
    disk_path: destPath,
    size_bytes: Buffer.byteLength(text, "utf8"),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    if (existing.disk_path && existing.disk_path !== destPath) {
      await removeQuiet(existing.disk_path);
      await removeEmptyDirs(path.dirname(existing.disk_path));
    }
    const { data, error } = await supabase
      .from("contents")
      .update(row)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from("contents").insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function listContents({ username, folder, q, limit = 500 }) {
  let query = supabase
    .from("contents")
    .select(
      "id, username, client_id, folder_name, folder_key, file_name, size_bytes, created_at, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(Math.min(Number(limit) || 500, 2000));

  if (username) query = query.eq("username", username);
  if (folder !== undefined && folder !== null && folder !== "*") {
    query = query.eq("folder_key", folder);
  }
  if (q) {
    const term = `%${String(q).replace(/[%*,()]/g, "").slice(0, 80)}%`;
    query = query.or(`file_name.ilike.${term},folder_name.ilike.${term},file_content.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function contentsForUser(username) {
  const { data, error } = await supabase
    .from("contents")
    .select(
      "id, username, client_id, folder_name, folder_key, file_name, size_bytes, created_at, updated_at"
    )
    .eq("username", username)
    .order("folder_key", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getContent(id) {
  const { data, error } = await supabase
    .from("contents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteContent(id) {
  const row = await getContent(id);
  if (!row) return null;
  if (row.disk_path && isInsideUploadDir(row.disk_path)) {
    await removeQuiet(row.disk_path);
    await removeEmptyDirs(path.dirname(row.disk_path));
  }
  const { error } = await supabase.from("contents").delete().eq("id", id);
  if (error) throw error;
  return row;
}

export async function deleteContentFolder(username, folderPath) {
  const { exact, prefix } = subtreeFilter(folderPath);
  const { data: rows, error } = await supabase
    .from("contents")
    .select("id, folder_key")
    .eq("username", username);
  if (error) throw error;

  const matched = (rows || []).filter((row) => {
    if (!prefix) return row.folder_key === "";
    return row.folder_key === exact || row.folder_key.startsWith(prefix);
  });

  for (const row of matched) {
    await deleteContent(row.id);
  }
  return { deleted: matched.length };
}
