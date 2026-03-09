"use client";

import { useEffect, useRef } from "react";

import {
  DEPLOYMENT_REFRESH_KEY,
  isChunkLoadError,
  performDeploymentRefresh,
} from "@/lib/utils/deployment-refresh";

const VERSION_API = "/api/version";

export function DeploymentRefreshHandler() {
  const initialVersionRef = useRef<string | null>(null);
  const hasCheckedVersionRef = useRef(false);

  useEffect(() => {
    function checkVersion(onVisible: boolean) {
      fetch(VERSION_API, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { version?: string } | null) => {
          if (!data?.version) return;
          const current = data.version;
          if (!hasCheckedVersionRef.current) {
            initialVersionRef.current = current;
            hasCheckedVersionRef.current = true;
            return;
          }
          if (
            onVisible &&
            initialVersionRef.current !== null &&
            current !== initialVersionRef.current
          ) {
            performDeploymentRefresh();
          }
        })
        .catch(() => {});
    }

    checkVersion(false);

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      checkVersion(true);
    }

    function handleError(event: ErrorEvent) {
      const message = event.message ?? String(event);
      if (!isChunkLoadError(message)) return;
      if (sessionStorage.getItem(DEPLOYMENT_REFRESH_KEY) === "true") return;
      event.preventDefault();
      performDeploymentRefresh();
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const message =
        event.reason?.message ??
        event.reason?.error?.message ??
        String(event.reason) ??
        "";
      if (!isChunkLoadError(message)) return;
      if (sessionStorage.getItem(DEPLOYMENT_REFRESH_KEY) === "true") return;
      event.preventDefault();
      performDeploymentRefresh();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("error", handleError);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
    };
  }, []);

  return null;
}
