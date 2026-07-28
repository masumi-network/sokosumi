"use client";

import { useEffect, useState } from "react";
import type { ChatRoomPresence } from "@/lib/clients/generated/core";

/**
 * Core derives everyone else's presence from how long ago their session was
 * touched (`apps/core/src/routes/v1/chats/rooms/helpers.ts`). Mirroring the
 * same idle window here keeps the dot you see for yourself in step with the dot
 * your teammates see for you, without a round-trip.
 */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const TICK_INTERVAL_MS = 30 * 1000;
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

export function useSelfPresence(): ChatRoomPresence {
  const [presence, setPresence] = useState<ChatRoomPresence>("online");

  useEffect(() => {
    let lastActivityAt = Date.now();

    function resolvePresence(): ChatRoomPresence {
      if (!navigator.onLine) {
        return "offline";
      }
      if (document.hidden) {
        return "afk";
      }

      return Date.now() - lastActivityAt <= ONLINE_WINDOW_MS ? "online" : "afk";
    }

    function sync() {
      setPresence(resolvePresence());
    }

    function handleActivity() {
      lastActivityAt = Date.now();
      sync();
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }
    window.addEventListener("focus", handleActivity);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    document.addEventListener("visibilitychange", handleActivity);

    const intervalId = window.setInterval(sync, TICK_INTERVAL_MS);
    sync();

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
      window.removeEventListener("focus", handleActivity);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      document.removeEventListener("visibilitychange", handleActivity);
      window.clearInterval(intervalId);
    };
  }, []);

  return presence;
}
