"use client";

import { useEffect, useState } from "react";

import {
  isInternalTraffic,
  syncInternalTraffic,
  withoutInternalTrafficParam,
} from "@/lib/analytics/internal-traffic";

let documentInternalOptOut = false;

/**
 * Syncs the internal-traffic cookie from `window.location.search`, strips the
 * `internal` query param via `window.history.replaceState`, and returns
 * whether analytics tags should load (`false` before mount and for internal
 * traffic). Keeps the opt-out for the current document if cookie writes fail,
 * so StrictMode replays or remounts do not re-enable tags.
 */
export function useInternalTrafficGate(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("internal");
    if (flag === "0") {
      documentInternalOptOut = false;
    }
    const internal = syncInternalTraffic(window.location.search);
    if (flag === "1" && internal && !isInternalTraffic()) {
      documentInternalOptOut = true;
    }
    setEnabled(!(internal || documentInternalOptOut));
    const cleanUrl = withoutInternalTrafficParam(window.location.href);
    if (cleanUrl) {
      window.history.replaceState(window.history.state, "", cleanUrl);
    }
  }, []);

  return enabled;
}
