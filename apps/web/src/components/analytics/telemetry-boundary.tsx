"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  isTelemetryBlockedPath,
  useTelemetryBoundaryGuard,
} from "@/hooks/effects/use-telemetry-boundary-guard";

interface TelemetryBoundaryProps {
  children: ReactNode;
}

export function TelemetryBoundary({ children }: TelemetryBoundaryProps) {
  const pathname = usePathname();
  const isBlocked = isTelemetryBlockedPath(pathname);

  useTelemetryBoundaryGuard(isBlocked);

  return isBlocked ? null : children;
}
