"use client";

import { CHAT_PRESENCE_ONLINE_WINDOW_MS } from "@sokosumi/utils";
import { useEffect, useState } from "react";

import type { ChatRoomPresence } from "@/lib/clients/generated/core";

/**
 * Same online idle window as Core session presence
 * (`apps/core/src/routes/v1/chats/rooms/helpers.ts`, via
 * `CHAT_PRESENCE_ONLINE_WINDOW_MS`). This is a local self-approx only
 * (navigator.onLine / document.hidden / activity) — not session presence,
 * and not teammate parity. Core forces the viewing user's own session to
 * "online".
 */
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

      return Date.now() - lastActivityAt <= CHAT_PRESENCE_ONLINE_WINDOW_MS
        ? "online"
        : "afk";
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
