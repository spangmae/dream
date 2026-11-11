function driveFolder(part) {
  const match = asText(part)
    .trim()
    .match(/^([a-zA-Z]):\\?$/);
  return match ? match[1].toUpperCase() : null;
}

export function asText(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

export function parseUploadFlag(body = {}) {
  const raw = body.isUpload ?? body.isupload ?? body.IsUpload;
  const text = asText(raw).trim().toLowerCase();
  return {
    raw,
    text,
    explicitFalse: text === "false" || text === "0" || text === "no",
    explicitTrue: text === "true" || text === "1" || text === "yes",
  };
}

export function isUploadEnabled(value) {
  return asText(value).trim().toLowerCase() === "true";
}

export function sanitizeSegment(name) {
  const drive = driveFolder(name);
  if (drive) return drive;

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
    .map((part) => driveFolder(part) || part)
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

export function splitNameAndDir(fileName) {
  const raw = asText(fileName).replace(/\\/g, "/");
  const parts = raw
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return { dir: "", name: parts[0] || "" };
  return {
    dir: logicalFolder(parts.slice(0, -1).join("/")),
    name: parts[parts.length - 1],
  };
}

export function dirnameOfUpload(filePath, fileName) {
  const raw = asText(filePath).replace(/\\/g, "/").replace(/\/+$/, "");
  if (!raw) return "";
  const parts = raw
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const last = parts[parts.length - 1];
  const name = splitNameAndDir(fileName).name || asText(fileName).trim();
  const lastIsFile =
    (name && last.toLowerCase() === name.toLowerCase()) ||
    (!name && /\.[^./]+$/.test(last));
  if (lastIsFile) parts.pop();
  return logicalFolder(parts.join("/"));
}

export function folderKeyFrom(folderName, filePath, fileName) {
  const split = splitNameAndDir(fileName);
  const folder = logicalFolder(folderName);
  const pathDir = dirnameOfUpload(filePath, split.name) || split.dir;
  if (pathDir && folder) {
    const folderLc = folder.toLowerCase();
    const pathLc = pathDir.toLowerCase();
    if (pathLc === folderLc || pathLc.startsWith(`${folderLc}/`)) return pathDir;
    if (folderLc.startsWith(`${pathLc}/`)) return folder;
    if (pathLc.endsWith(`/${folderLc}`) || pathLc.includes(`/${folderLc}/`)) return pathDir;
    return `${folder}/${pathDir}`;
  }
  return pathDir || folder || "";
}

export function uploadRootKey(folderName, folderKey) {
  const fromName = logicalFolder(folderName);
  if (fromName) return fromName;
  const parts = asText(folderKey).split("/").filter(Boolean);
  if (!parts.length) return "";
  if (/^[A-Z]$/.test(parts[0]) && parts[1]) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

export function numberedFolderKey(folderKey, n) {
  const parts = asText(folderKey).split("/").filter(Boolean);
  if (!parts.length) return n <= 1 ? "" : `upload ${n}`;
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = n <= 1 ? last : `${last} ${n}`;
  return parts.join("/");
}

export function replaceFolderRoot(folderKey, fromRoot, toRoot) {
  const key = asText(folderKey);
  const from = asText(fromRoot);
  const to = asText(toRoot);
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return key;
  if (key.toLowerCase() === from.toLowerCase()) return to;
  if (key.toLowerCase().startsWith(`${from.toLowerCase()}/`)) {
    return `${to}${key.slice(from.length)}`;
  }
  return key;
}

export function subtreeFilter(folderKey) {
  const key = asText(folderKey);
  if (!key) {
    return { exact: "", prefix: null };
  }
  return { exact: key, prefix: `${key}/` };
}
