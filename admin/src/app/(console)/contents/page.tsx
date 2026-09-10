"use client";

import { useEffect, useMemo, useState } from "react";
import { api, downloadHref, type ContentRow } from "@/lib/api";
import { formatBytes, formatDate, formatFullDate } from "@/lib/format";

export default function ContentsPage() {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<ContentRow | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const data = await api<{ contents: ContentRow[] }>(
      `/admin/contents${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`
    );
    setRows(data.contents);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        row.file_name.toLowerCase().includes(term) ||
        row.username.toLowerCase().includes(term) ||
        row.folder_key.toLowerCase().includes(term)
    );
  }, [rows, q]);

  async function openPreview(id: string) {
    const data = await api<{ content: ContentRow }>(`/admin/contents/${id}`);
    setPreview(data.content);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this text content from database and disk?")) return;
    await api(`/admin/contents/${id}`, { method: "DELETE" });
    setPreview(null);
    await load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Contents</h1>
          <p>Text payloads from POST /content-upload.</p>
        </div>
        <input
          className="search"
          placeholder="Search name, user, folder"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error ? <div className="error">{error}</div> : null}
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>User</th>
                <th>Folder</th>
                <th>Size</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    No content uploads yet.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.file_name}</td>
                    <td className="mono">{row.username}</td>
                    <td className="path">{row.folder_key || "/"}</td>
                    <td>{formatBytes(row.size_bytes)}</td>
                    <td>{formatDate(row.updated_at)}</td>
                    <td>
                      <button className="btn btn-ghost" type="button" onClick={() => openPreview(row.id)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {preview ? (
        <div className="modal-back" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <strong>{preview.file_name}</strong>
                <div className="mono">
                  {preview.username} · {preview.folder_key || "/"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a className="btn btn-ghost" href={downloadHref("contents", preview.id)}>
                  Download
                </a>
                <button className="btn btn-danger" type="button" onClick={() => remove(preview.id)}>
                  Delete
                </button>
              </div>
            </div>
            <div className="modal-b">
              <pre className="preview">{preview.file_content || ""}</pre>
              <p className="mono">{formatFullDate(preview.updated_at)}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
