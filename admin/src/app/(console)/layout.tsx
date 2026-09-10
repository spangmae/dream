"use client";

import { AuthGate } from "@/components/AuthGate";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
