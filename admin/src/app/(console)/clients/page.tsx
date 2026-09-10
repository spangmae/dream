"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ClientRow } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ clients: ClientRow[] }>("/admin/clients")
      .then((data) => setClients(data.clients))
      .catch((err) => setError(err.message));
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter(
      (row) =>
        row.username.toLowerCase().includes(term) ||
        String(row.custom_id || "").toLowerCase().includes(term)
    );
  }, [clients, q]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p>Every device/user that called POST /register.</p>
        </div>
        <input
          className="search"
          placeholder="Search username or client id"
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
                <th>Username</th>
                <th>Client ID</th>
                <th>Files</th>
                <th>Contents</th>
                <th>Storage</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    No clients yet.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="row-click"
                    onClick={() => router.push(`/explorer?user=${encodeURIComponent(row.username)}`)}
                  >
                    <td>{row.username}</td>
                    <td className="mono">{row.custom_id || "—"}</td>
                    <td>{row.file_count}</td>
                    <td>{row.content_count}</td>
                    <td>{formatBytes(row.bytes)}</td>
                    <td>{formatDate(row.last_seen_at)}</td>
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
