"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ClientRow } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";

type ClientWithStatus = ClientRow & { online?: boolean };

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientWithStatus[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api<{ clients: ClientWithStatus[] }>("/admin/clients");
    setClients(data.clients);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, 8000);
    return () => window.clearInterval(timer);
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

  const offlineCount = clients.filter((row) => !row.online).length;

  async function removeOne(username: string) {
    if (!window.confirm(`Remove ${username} from Supabase? Live sockets are not deleted.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/clients/${encodeURIComponent(username)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeOffline() {
    if (!offlineCount) return;
    if (!window.confirm(`Remove ${offlineCount} offline client(s) from Supabase?`)) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ deleted: number }>("/admin/clients/purge-offline", { method: "POST" });
      await load();
      if (!data.deleted) setError("No offline clients to remove.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purge failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p>Registered devices. Live = connected on Socket.IO. Offline rows can be removed from Supabase.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="search"
            placeholder="Search username or client id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-danger" type="button" disabled={busy || !offlineCount} onClick={removeOffline}>
            Remove offline ({offlineCount})
          </button>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Username</th>
                <th>Client ID</th>
                <th>Files</th>
                <th>Contents</th>
                <th>Storage</th>
                <th>Last seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    No clients yet.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="row-click">
                    <td>
                      <span className={`badge ${row.online ? "" : "badge-text"}`}>
                        {row.online ? "live" : "offline"}
                      </span>
                    </td>
                    <td onClick={() => router.push(`/explorer?user=${encodeURIComponent(row.username)}`)}>
                      {row.username}
                    </td>
                    <td className="mono">{row.custom_id || "—"}</td>
                    <td>{row.file_count}</td>
                    <td>{row.content_count}</td>
                    <td>{formatBytes(row.bytes)}</td>
                    <td>{formatDate(row.last_seen_at)}</td>
                    <td>
                      {row.online ? (
                        "—"
                      ) : (
                        <button
                          className="btn btn-danger"
                          type="button"
                          disabled={busy}
                          onClick={() => removeOne(row.username)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
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
