"use client";

import { useEventListener } from "@/hooks/effects/use-event-listener";
import {
  hasDeploymentRefreshGuard,
  isStaleDeploymentError,
  performDeploymentRefresh,
} from "@/lib/utils/deployment-refresh";

export function DeploymentRefreshHandler() {
  useEventListener("window", "error", (event) => {
    const message = event.message ?? String(event);
    if (!isStaleDeploymentError(message)) return;
    if (hasDeploymentRefreshGuard()) return;
    event.preventDefault();
    performDeploymentRefresh();
  });

  useEventListener("window", "unhandledrejection", (event) => {
    const message =
      event.reason?.message ??
      event.reason?.error?.message ??
      String(event.reason);
    if (!isStaleDeploymentError(message)) return;
    if (hasDeploymentRefreshGuard()) return;
    event.preventDefault();
    performDeploymentRefresh();
  });

  return null;
}
