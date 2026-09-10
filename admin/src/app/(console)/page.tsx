"use client";

import { useEffect, useState } from "react";
import { api, type FileRow } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";

type Stats = {
  clients: number;
  files: number;
  contents: number;
  bytes: number;
  recentFiles: FileRow[];
};

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Stats>("/admin/stats")
      .then(setStats)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!stats) return <p className="empty">Loading overview…</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Live totals from Supabase metadata and VPS disk uploads.</p>
        </div>
      </div>
      <section className="stats">
        <article className="stat">
          <span>Clients</span>
          <strong>{stats.clients}</strong>
        </article>
        <article className="stat">
          <span>Files</span>
          <strong>{stats.files}</strong>
        </article>
        <article className="stat">
          <span>Text contents</span>
          <strong>{stats.contents}</strong>
        </article>
        <article className="stat">
          <span>Stored bytes</span>
          <strong>{formatBytes(stats.bytes)}</strong>
        </article>
      </section>
      <section className="panel">
        <div className="panel-h">
          <strong>Recent uploads</strong>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>User</th>
                <th>Folder</th>
                <th>Size</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentFiles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    No files yet.
                  </td>
                </tr>
              ) : (
                stats.recentFiles.map((file) => (
                  <tr key={file.id}>
                    <td>{file.file_name}</td>
                    <td className="mono">{file.username}</td>
                    <td className="path">{file.folder_key || "/"}</td>
                    <td>{formatBytes(file.size_bytes)}</td>
                    <td>{formatDate(file.updated_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
