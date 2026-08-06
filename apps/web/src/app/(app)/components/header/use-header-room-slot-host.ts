"use client";

import { useLayoutEffect, useState } from "react";

const HEADER_ROOM_SLOT_SELECTOR = "[data-app-header-room-slot]";

export function useHeaderRoomSlotHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    let current: HTMLElement | null = null;

    function syncHost() {
      const next = document.querySelector(HEADER_ROOM_SLOT_SELECTOR);
      if (next === current) {
        return;
      }
      current = next;
      setHost(next);
    }

    syncHost();

    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      current = null;
      setHost(null);
    };
  }, []);

  return host;
}
