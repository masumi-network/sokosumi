"use client";

import { useState } from "react";

import { useLayoutMutationObserver } from "@/hooks/effects/use-mutation-observer";

const HEADER_ROOM_SLOT_SELECTOR = "[data-app-header-room-slot]";

export function useHeaderRoomSlotHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutMutationObserver(
    "body",
    () => {
      const next = document.querySelector<HTMLElement>(
        HEADER_ROOM_SLOT_SELECTOR,
      );
      setHost((current) => (next === current ? current : next));
    },
    {
      init: { childList: true, subtree: true },
      immediate: true,
    },
  );

  return host;
}
