"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  api,
  downloadHref,
  type ClientRow,
  type ContentRow,
  type FileRow,
  type FolderNode,
} from "@/lib/api";
import { formatBytes, formatDate, formatFullDate } from "@/lib/format";

type TreeResponse = {
  client: ClientRow;
  tree: { fileCount: number; contentCount: number; children: FolderNode[] };
  files: FileRow[];
  contents: ContentRow[];
};

type Item =
  | { kind: "file"; id: string; name: string; folder: string; size: number; path: string; updated: string }
  | { kind: "content"; id: string; name: string; folder: string; size: number; path: string; updated: string };

function TreeList({
  nodes,
  selected,
  onSelect,
  depth = 0,
}: {
  nodes: FolderNode[];
  selected: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => (
        <Fragment key={node.path}>
          <button
            type="button"
            className={`tree-row ${selected === node.path ? "active" : ""}`}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => onSelect(node.path)}
          >
            <span style={{ flex: 1, textAlign: "left" }}>{node.name}</span>
            <small className="mono">{node.fileCount + node.contentCount}</small>
          </button>
          <TreeList nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
        </Fragment>
      ))}
    </>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense fallback={<p className="empty">Loading explorer…</p>}>
      <Explorer />
    </Suspense>
  );
}

function Explorer() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [username, setUsername] = useState(searchParams.get("user") || "");
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [folder, setFolder] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, Item>>({});
  const [preview, setPreview] = useState<ContentRow | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ clients: ClientRow[] }>("/admin/clients")
      .then((data) => {
        setClients(data.clients);
        if (!username && data.clients[0]) setUsername(data.clients[0].username);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function loadTree(user: string) {
    if (!user) return;
    setError("");
    const data = await api<TreeResponse>(`/admin/clients/${encodeURIComponent(user)}/tree`);
    setTree(data);
    setFolder("");
    setSelected({});
  }

  useEffect(() => {
    if (username) {
      loadTree(username).catch((err) => setError(err.message));
    }
  }, [username]);

  const items = useMemo<Item[]>(() => {
    if (!tree) return [];
    const files = tree.files.map((file) => ({
      kind: "file" as const,
      id: file.id,
      name: file.file_name,
      folder: file.folder_key,
      size: file.size_bytes,
      path: file.file_path || "",
      updated: file.updated_at,
    }));
    const contents = tree.contents.map((row) => ({
      kind: "content" as const,
      id: row.id,
      name: row.file_name,
      folder: row.folder_key,
      size: row.size_bytes,
      path: row.folder_name,
      updated: row.updated_at,
    }));
    return [...files, ...contents]
      .filter((item) => item.folder === folder)
      .filter((item) => {
        const term = q.trim().toLowerCase();
        if (!term) return true;
        return item.name.toLowerCase().includes(term) || item.path.toLowerCase().includes(term);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tree, folder, q]);

  const crumbs = folder ? folder.split("/") : [];
  const selectedList = Object.values(selected);

  async function removeSelected() {
    setBusy(true);
    try {
      for (const item of selectedList) {
        const path = item.kind === "file" ? `/admin/files/${item.id}` : `/admin/contents/${item.id}`;
        await api(path, { method: "DELETE" });
      }
      setSelected({});
      await loadTree(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function removeFolder() {
    setBusy(true);
    try {
      await api("/admin/folders", {
        method: "DELETE",
        body: JSON.stringify({ username, folderPath: folder }),
      });
      setSelected({});
      await loadTree(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Folder delete failed");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function openPreview(id: string) {
    const data = await api<{ content: ContentRow }>(`/admin/contents/${id}`);
    setPreview(data.content);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Explorer</h1>
          <p>Browse uploaded folders like a file manager. Files stay on the VPS; this view is metadata plus download.</p>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="explorer">
        <div className="pane">
          <div className="pane-h">
            <strong>Clients</strong>
          </div>
          {clients.map((client) => (
            <button
              key={client.id}
              type="button"
              className={`list-item ${username === client.username ? "active" : ""}`}
              onClick={() => setUsername(client.username)}
            >
              <span>
                {client.username}
                <small>id {client.custom_id || "—"} · {formatBytes(client.bytes)}</small>
              </span>
            </button>
          ))}
          {clients.length === 0 ? <div className="empty">No clients</div> : null}
        </div>
        <div className="pane">
          <div className="pane-h">
            <strong>Folders</strong>
          </div>
          <button
            type="button"
            className={`tree-row ${folder === "" ? "active" : ""}`}
            onClick={() => setFolder("")}
          >
            <span style={{ flex: 1, textAlign: "left" }}>/</span>
            <small className="mono">
              {(tree?.tree.fileCount || 0) + (tree?.tree.contentCount || 0)}
            </small>
          </button>
          <TreeList nodes={tree?.tree.children || []} selected={folder} onSelect={setFolder} />
        </div>
        <div className="pane">
          <div className="pane-h">
            <div className="crumb">
              <button type="button" onClick={() => setFolder("")}>
                root
              </button>
              {crumbs.map((part, index) => {
                const path = crumbs.slice(0, index + 1).join("/");
                return (
                  <span key={path}>
                    /
                    <button type="button" onClick={() => setFolder(path)}>
                      {part}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
          <div className="toolbar">
            <input
              className="search"
              placeholder="Filter this folder"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              className="btn btn-danger"
              type="button"
              disabled={!selectedList.length || busy}
              onClick={() => setConfirm("items")}
            >
              Delete selected ({selectedList.length})
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy || !folder}
              onClick={() => setConfirm("folder")}
            >
              Delete this folder
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Original path</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty">
                      Nothing in this folder.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const key = `${item.kind}:${item.id}`;
                    return (
                      <tr key={key}>
                        <td>
                          <input
                            className="check"
                            type="checkbox"
                            checked={Boolean(selected[key])}
                            onChange={(e) => {
                              setSelected((prev) => {
                                const next = { ...prev };
                                if (e.target.checked) next[key] = item;
                                else delete next[key];
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td>{item.name}</td>
                        <td>
                          <span className={`badge ${item.kind === "content" ? "badge-text" : ""}`}>
                            {item.kind === "file" ? "file" : "text"}
                          </span>
                        </td>
                        <td>{formatBytes(item.size)}</td>
                        <td className="path" title={item.path}>
                          {item.path || "—"}
                        </td>
                        <td>{formatDate(item.updated)}</td>
                        <td>
                          {item.kind === "file" ? (
                            <a className="btn btn-ghost" href={downloadHref("files", item.id)}>
                              Download
                            </a>
                          ) : (
                            <button className="btn btn-ghost" type="button" onClick={() => openPreview(item.id)}>
                              View
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {preview ? (
        <div className="modal-back" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <strong>{preview.file_name}</strong>
                <div className="mono">{preview.folder_key || "/"}</div>
              </div>
              <a className="btn btn-ghost" href={downloadHref("contents", preview.id)}>
                Download
              </a>
            </div>
            <div className="modal-b">
              <pre className="preview">{preview.file_content || ""}</pre>
              <p className="mono">{formatFullDate(preview.updated_at)}</p>
            </div>
          </div>
        </div>
      ) : null}

      {confirm ? (
        <div className="modal-back" onClick={() => setConfirm(null)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <strong>{confirm === "folder" ? "Delete folder?" : "Delete items?"}</strong>
            </div>
            <div className="modal-b">
              {confirm === "folder"
                ? `This removes every file and text item under "${folder || "/"}" for ${username}, including disk copies.`
                : `This permanently deletes ${selectedList.length} selected item(s) from the database and VPS disk.`}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={busy}
                onClick={confirm === "folder" ? removeFolder : removeSelected}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
