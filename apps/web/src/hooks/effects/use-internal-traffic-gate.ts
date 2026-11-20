"use client";

import { useEffect, useState } from "react";

import {
  syncInternalTraffic,
  withoutInternalTrafficParam,
} from "@/lib/analytics/internal-traffic";

/**
 * Syncs the internal-traffic cookie from `window.location.search`, strips the
 * `internal` query param via `window.history.replaceState`, and returns
 * whether analytics tags should load (`false` before mount and for internal
 * traffic).
 */
export function useInternalTrafficGate(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(!syncInternalTraffic(window.location.search));
    const cleanUrl = withoutInternalTrafficParam(window.location.href);
    if (cleanUrl) {
      window.history.replaceState(window.history.state, "", cleanUrl);
    }
  }, []);

  return enabled;
}
