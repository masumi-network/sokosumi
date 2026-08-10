"use client";

import { CHAT_PRESENCE_ONLINE_WINDOW_MS } from "@sokosumi/utils";
import { useEffect, useState } from "react";

import type { ChatRoomPresence } from "@/lib/clients/generated/core";

/**
 * Local self-approx for account chrome (navigator.onLine / document.hidden /
 * activity). Teammate dots use Ably org Presence (ADR-0002); shares the same
 * online idle window constant for Online vs AFK.
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
