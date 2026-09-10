export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000";

const TOKEN_KEY = "dream_admin_token";

export type Admin = { id: string; email: string };

export type ClientRow = {
  id: string;
  username: string;
  custom_id: string | null;
  last_seen_at: string;
  created_at: string;
  file_count: number;
  content_count: number;
  bytes: number;
};

export type FileRow = {
  id: string;
  username: string;
  client_id: string | null;
  folder_name: string;
  folder_key: string;
  file_name: string;
  file_path: string | null;
  size_bytes: number;
  mime: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentRow = {
  id: string;
  username: string;
  client_id: string | null;
  folder_name: string;
  folder_key: string;
  file_name: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
  file_content?: string;
};

export type FolderNode = {
  path: string;
  name: string;
  fileCount: number;
  contentCount: number;
  children: FolderNode[];
};

export function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (res.status === 401 && !path.startsWith("/admin/login")) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function downloadHref(kind: "files" | "contents", id: string) {
  return `${API_URL}/admin/${kind}/${id}/download?access_token=${encodeURIComponent(getToken())}`;
}
