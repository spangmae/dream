import { supabase } from "../db/supabase.js";
import { asText } from "../utils/paths.js";

export async function upsertClient(username, customId) {
  const name = asText(username).trim();
  if (!name) {
    const err = new Error("username is required");
    err.status = 400;
    throw err;
  }

  const payload = {
    username: name,
    custom_id: asText(customId),
    last_seen_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("clients")
    .upsert(payload, { onConflict: "username" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function listClients() {
  const { data, error } = await supabase
    .from("client_overview")
    .select("*")
    .order("last_seen_at", { ascending: false });
  if (!error) return data || [];

  const fallback = await supabase
    .from("clients")
    .select("*")
    .order("last_seen_at", { ascending: false });
  if (fallback.error) throw error;
  return (fallback.data || []).map((row) => ({
    ...row,
    file_count: 0,
    content_count: 0,
    bytes: 0,
  }));
}

export async function getClient(username) {
  const { data, error } = await supabase
    .from("client_overview")
    .select("*")
    .eq("username", username)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteClient(username) {
  const name = asText(username).trim();
  if (!name) {
    const err = new Error("username is required");
    err.status = 400;
    throw err;
  }
  const contents = await supabase.from("contents").delete().eq("username", name);
  if (contents.error) throw contents.error;
  const files = await supabase.from("files").delete().eq("username", name);
  if (files.error) throw files.error;
  const clients = await supabase.from("clients").delete().eq("username", name);
  if (clients.error) throw clients.error;
  return { username: name };
}
