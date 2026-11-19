"use client";

import { useLayoutEffect, useState } from "react";

const HEADER_ROOM_SLOT_SELECTOR = "[data-app-header-room-slot]";

export function useHeaderRoomSlotHost(): HTMLElement | null {
  return useHeaderSlotHost(HEADER_ROOM_SLOT_SELECTOR);
}

export function useHeaderSlotHost(selector: string): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    let current: HTMLElement | null = null;

    function syncHost() {
      const next = document.querySelector<HTMLElement>(selector);
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
  }, [selector]);

  return host;
}
