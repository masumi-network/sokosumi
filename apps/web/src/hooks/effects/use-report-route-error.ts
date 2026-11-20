"use client";

import { useEffect, useState } from "react";
import { reportRouteError } from "@/lib/sentry/report-route-error";
import {
  hasDeploymentRefreshGuard,
  isStaleDeploymentError,
  performDeploymentRefresh,
} from "@/lib/utils/deployment-refresh";

/**
 * Reports a route error boundary failure to Sentry whenever `error` changes.
 */
export function useReportRouteError(error: Error & { digest?: string }): void {
  useEffect(() => {
    reportRouteError(error);
  }, [error]);
}

/**
 * Handles a root error boundary failure: refreshes once on a stale-deployment
 * error, otherwise reports to Sentry and returns `true` once the fallback UI
 * should render.
 */
export function useGlobalRouteError(
  error: Error & { digest?: string },
): boolean {
  const [shouldReload, setShouldReload] = useState(false);

  useEffect(() => {
    const message = error?.message ?? "";
    if (isStaleDeploymentError(message) && !hasDeploymentRefreshGuard()) {
      performDeploymentRefresh();
      return;
    }
    reportRouteError(error);
    const id = setTimeout(() => setShouldReload(true), 0);
    return () => clearTimeout(id);
  }, [error]);

  return shouldReload;
}
