import { supabase } from "../db/supabase.js";
import { recentFiles } from "./files.js";

export async function getStats() {
  const [clients, files, contents, bytes, recent] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("files").select("*", { count: "exact", head: true }),
    supabase.from("contents").select("*", { count: "exact", head: true }),
    supabase.rpc("file_storage_bytes"),
    recentFiles(12),
  ]);

  for (const result of [clients, files, contents, bytes]) {
    if (result.error) throw result.error;
  }

  return {
    clients: clients.count || 0,
    files: files.count || 0,
    contents: contents.count || 0,
    bytes: Number(bytes.data || 0),
    recentFiles: recent,
  };
}
