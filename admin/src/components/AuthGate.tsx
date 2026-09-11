"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, clearToken, getToken, type Admin } from "@/lib/api";

const links = [
  { href: "/", label: "Overview" },
  { href: "/clients", label: "Clients" },
  { href: "/explorer", label: "Explorer" },
  { href: "/contents", label: "Contents" },
  { href: "/live", label: "Live" },
];

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{ admin: Admin }>("/admin/me")
      .then((data) => {
        setAdmin(data.admin);
        setReady(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!ready || !admin) {
    return <div className="login-shell">Loading console…</div>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-kicker">Dream</div>
          <strong>Control plane</strong>
        </div>
        <nav className="nav">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "active" : ""}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-end">
          <div className="email">{admin.email}</div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              clearToken();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
