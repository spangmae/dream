const WIN_DRIVE = /^[a-zA-Z]:/;

export function asText(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

export function isUploadEnabled(value) {
  return asText(value).trim().toLowerCase() === "true";
}

export function sanitizeSegment(name) {
  const stripped = asText(name)
    .replace(/[/\\]/g, "")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+/g, "")
    .trim();
  const cleaned = stripped || "unnamed";
  if (cleaned === "." || cleaned === "..") return "unnamed";
  return cleaned.slice(0, 200);
}

export function logicalFolder(folderName) {
  return asText(folderName)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part || part === "." || part === "..") return false;
      if (WIN_DRIVE.test(part) && part.endsWith(":")) return false;
      return true;
    })
    .join("/");
}

export function folderKeyFrom(folderName, filePath) {
  const fromFolder = logicalFolder(folderName);
  if (fromFolder) return fromFolder;

  const raw = asText(filePath).replace(/\\/g, "/");
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return logicalFolder(parts.slice(0, -1).join("/"));
}

export function subtreeFilter(folderKey) {
  const key = asText(folderKey);
  if (!key) {
    return { exact: "", prefix: null };
  }
  return { exact: key, prefix: `${key}/` };
}
