"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isTelemetryBlockedPath } from "@/lib/analytics/telemetry-blocked-paths";

interface TelemetryBoundaryProps {
  children: ReactNode;
}

export function TelemetryBoundary({ children }: TelemetryBoundaryProps) {
  const pathname = usePathname();
  return isTelemetryBlockedPath(pathname) ? null : children;
}
