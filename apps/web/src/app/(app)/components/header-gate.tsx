"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface HeaderGateProps {
  children: ReactNode;
}

/**
 * Client-only gate around the shared breadcrumb Header. Hermes owns its
 * own chrome and doesn't want the global header bar, so we render nothing
 * on `/hermes` (and any nested route). Lives as a client wrapper so the
 * underlying Header can stay an async server component — server components
 * are valid children of a client component, React handles the boundary.
 */
export default function HeaderGate({ children }: HeaderGateProps) {
  const pathname = usePathname();
  if (pathname === "/hermes" || pathname?.startsWith("/hermes/")) return null;
  return <>{children}</>;
}
