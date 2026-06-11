"use client";

import { useSyncExternalStore } from "react";

/**
 * Resolves the client's IANA timezone, deferring to `null` on the server and
 * during the first client render so SSR and hydration agree (the server has no
 * client timezone). The value never changes after mount, so the subscription is
 * a no-op.
 */
function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function getServerSnapshot(): null {
  return null;
}

export function useTimeZone(): string | null {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
