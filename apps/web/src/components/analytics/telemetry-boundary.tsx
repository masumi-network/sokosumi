"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  isTelemetryBlockedPath,
  useBlockedRouteGoogleTelemetry,
} from "@/hooks/effects/use-blocked-route-google-telemetry";

interface TelemetryBoundaryProps {
  children: ReactNode;
}

export function TelemetryBoundary({ children }: TelemetryBoundaryProps) {
  const pathname = usePathname();
  const isBlocked = isTelemetryBlockedPath(pathname);

  useBlockedRouteGoogleTelemetry(isBlocked);

  return isBlocked ? null : children;
}
