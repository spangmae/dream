"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, diskDownloadHref } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { isTextFileName } from "@/lib/text";

type DiskItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
};

function parentRel(rel: string) {
  const parts = rel.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export default function DiskPage() {
  const [current, setCurrent] = useState("");
  const [address, setAddress] = useState("");
  const [items, setItems] = useState<DiskItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState<{ name: string; path: string; content: string } | null>(null);
  const historyRef = useRef<string[]>([]);

  const sorted = useMemo(() => items, [items]);

  async function load(rel: string, pushHistory = false) {
    setError("");
    const data = await api<{ path: string; items: DiskItem[] }>(
      `/admin/disk?path=${encodeURIComponent(rel)}`
    );
    if (pushHistory && current !== rel) historyRef.current.push(current);
    setCurrent(data.path);
    setAddress(data.path);
    setItems(data.items);
    setPicked(new Set());
  }

  useEffect(() => {
    load("").catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goTo(rel: string, push = true) {
    load(rel, push).catch((err) => setError(err.message));
  }

  function toggle(item: DiskItem) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  }

  async function openItem(item: DiskItem) {
    if (item.isDirectory) {
      goTo(item.path);
      return;
    }
    if (isTextFileName(item.name)) {
      try {
        const data = await api<{ name: string; path: string; content: string }>(
          `/admin/disk/preview?path=${encodeURIComponent(item.path)}`
        );
        setPreview(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Preview failed");
      }
      return;
    }
    window.location.href = diskDownloadHref(item.path);
  }

  async function downloadPicked() {
    const chosen = sorted.filter((item) => picked.has(item.path));
    if (!chosen.length) {
      setError("Select files and/or folders first.");
      return;
    }
    setBusy(true);
    setError("");
    const files: DiskItem[] = [];
    const seen = new Set<string>();
    try {
      for (const item of chosen) {
        const data = await api<{ files: DiskItem[] }>(
          `/admin/disk/collect?path=${encodeURIComponent(item.path)}`
        );
        for (const file of data.files || []) {
          if (!seen.has(file.path)) {
            seen.add(file.path);
            files.push(file);
          }
        }
      }
      if (!files.length) {
        setError("No files found in the selection.");
        return;
      }
      for (const file of files) {
        const link = document.createElement("a");
        link.href = diskDownloadHref(file.path);
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  async function deletePicked() {
    const targets = sorted.filter((item) => picked.has(item.path));
    if (!targets.length) return;
    setBusy(true);
    setError("");
    const failed: string[] = [];
    for (const item of targets) {
      try {
        await api("/admin/disk", {
          method: "DELETE",
          body: JSON.stringify({ path: item.path }),
        });
      } catch (err) {
        failed.push(`${item.name}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    setBusy(false);
    setConfirm(false);
    await load(current).catch((err) => setError(err.message));
    if (failed.length) setError(`${failed.length} delete(s) failed. Others continued.\n${failed.join("\n")}`);
  }

  function onAddress(event: FormEvent) {
    event.preventDefault();
    goTo(address.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""), true);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Disk</h1>
          <p>VPS uploads folder. Same files FileZilla shows, with download and delete.</p>
        </div>
      </div>
      {error ? <div className="error" style={{ whiteSpace: "pre-wrap" }}>{error}</div> : null}
      <div className="panel">
        <form className="fe-toolbar" onSubmit={onAddress}>
          <button
            className="btn"
            type="button"
            onClick={() => {
              const prev = historyRef.current.pop();
              goTo(prev || "", false);
            }}
          >
            Back
          </button>
          <button className="btn" type="button" onClick={() => goTo(parentRel(current), true)}>
            Up
          </button>
          <input
            className="fe-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="relative path inside uploads"
          />
          <button className="btn" type="submit">
            Go
          </button>
          <button className="btn" type="button" onClick={() => goTo(current, false)}>
            Refresh
          </button>
        </form>
        <div className="fe-toolbar">
          <button className="btn" type="button" onClick={() => setPicked(new Set(sorted.map((item) => item.path)))}>
            Select all
          </button>
          <button className="btn" type="button" onClick={() => setPicked(new Set())} disabled={!picked.size}>
            Clear
          </button>
          <button className="btn btn-primary" type="button" onClick={downloadPicked} disabled={!picked.size || busy} style={{ width: "auto" }}>
            {busy ? "Working…" : "Download"}
          </button>
          <button className="btn btn-danger" type="button" onClick={() => setConfirm(true)} disabled={!picked.size || busy}>
            Delete
          </button>
          <span className="mono">
            {picked.size} selected · /{current || ""}
          </span>
        </div>
        <p className="fe-hint">
          Tick files and folders, then Download. Selected folders include every file inside them.
          Double-click text files (.txt, .js, .env, and similar) to open them in the panel.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Empty folder.
                  </td>
                </tr>
              ) : (
                sorted.map((item) => (
                  <DiskRow
                    key={item.path}
                    item={item}
                    picked={picked.has(item.path)}
                    onToggle={() => toggle(item)}
                    onOpen={() => openItem(item)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {preview ? (
        <div className="modal-back" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <strong>{preview.name}</strong>
                <div className="mono">{preview.path}</div>
              </div>
              <a className="btn btn-ghost" href={diskDownloadHref(preview.path)}>
                Download
              </a>
            </div>
            <div className="modal-b">
              <pre className="preview">{preview.content}</pre>
            </div>
          </div>
        </div>
      ) : null}
      {confirm ? (
        <div className="modal-back" onClick={() => setConfirm(false)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <strong>Delete from VPS disk?</strong>
            </div>
            <div className="modal-b">
              This permanently removes {picked.size} item(s) from the uploads folder. Folders are deleted recursively.
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" type="button" disabled={busy} onClick={deletePicked}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DiskRow({
  item,
  picked,
  onToggle,
  onOpen,
}: {
  item: DiskItem;
  picked: boolean;
  onToggle: () => void;
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
          onToggle();
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
        if (event.ctrlKey || event.metaKey) onToggle();
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
          onChange={onToggle}
        />
      </td>
      <td>{item.name}</td>
      <td>
        <span className={`badge ${item.isDirectory ? "" : "badge-text"}`}>
          {item.isDirectory ? "folder" : "file"}
        </span>
      </td>
      <td>{item.isDirectory ? "—" : formatBytes(item.size)}</td>
      <td>{formatDate(item.mtime)}</td>
    </tr>
  );
}
