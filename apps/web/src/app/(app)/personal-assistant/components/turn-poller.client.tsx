"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 4_000;
const STATUS_ENDPOINT = "/api/personal-assistant/turn-status";

interface TurnStatusSnapshot {
  turnId: string;
  status: string;
  fingerprint: string;
}

/**
 * While turns are in flight, poll a narrow status endpoint and re-render the
 * server tree only when something actually changed (status, answer, events,
 * decisions). Avoids refreshing the whole page — including legacy history —
 * every few seconds. Pauses when the tab is hidden.
 */
export function TurnPoller({ activeTurnIds }: { activeTurnIds: string[] }) {
  const router = useRouter();
  const lastFingerprints = useRef<Map<string, string>>(new Map());
  const key = activeTurnIds.join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const controller = new AbortController();

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`${STATUS_ENDPOINT}?id=${key}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          // Fall back to a plain refresh so a transient status failure never
          // freezes the UI on a stale turn.
          if (response.status >= 500) router.refresh();
          return;
        }
        const body = (await response.json()) as {
          snapshots?: TurnStatusSnapshot[];
        };
        const snapshots = body.snapshots ?? [];
        let changed = snapshots.length !== activeTurnIds.length;
        for (const snapshot of snapshots) {
          if (
            lastFingerprints.current.get(snapshot.turnId) !==
            snapshot.fingerprint
          ) {
            changed = true;
          }
          lastFingerprints.current.set(snapshot.turnId, snapshot.fingerprint);
        }
        if (changed && !cancelled) router.refresh();
      } catch {
        // Aborted or offline: try again on the next tick.
      }
    };

    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const onVisibility = () => void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, activeTurnIds.length, router]);

  return null;
}
