"use client";

import { useEffect } from "react";

import {
  hasDeploymentRefreshGuard,
  isStaleDeploymentError,
  performDeploymentRefresh,
} from "@/lib/utils/deployment-refresh";

export function DeploymentRefreshHandler() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      const message = event.message ?? String(event);
      if (!isStaleDeploymentError(message)) return;
      if (hasDeploymentRefreshGuard()) return;
      event.preventDefault();
      performDeploymentRefresh();
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const message =
        event.reason?.message ??
        event.reason?.error?.message ??
        String(event.reason);
      if (!isStaleDeploymentError(message)) return;
      if (hasDeploymentRefreshGuard()) return;
      event.preventDefault();
      performDeploymentRefresh();
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
    };
  }, []);

  return null;
}
