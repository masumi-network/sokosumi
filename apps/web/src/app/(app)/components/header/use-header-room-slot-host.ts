"use client";

import { useLayoutEffect, useState } from "react";

const HEADER_ROOM_SLOT_SELECTOR = "[data-app-header-room-slot]";

export function useHeaderRoomSlotHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    function queryHost(): HTMLElement | null {
      return document.querySelector(HEADER_ROOM_SLOT_SELECTOR);
    }

    let element = queryHost();
    if (element == null) {
      element = queryHost();
    }
    setHost(element);

    return () => {
      setHost(null);
    };
  }, []);

  return host;
}
