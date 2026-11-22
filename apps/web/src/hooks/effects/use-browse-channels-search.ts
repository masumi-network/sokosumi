"use client";

import type { DiscoverableChatRoom } from "@sokosumi/core-client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listDiscoverableChannelsAction } from "@/app/chat/actions";

/**
 * Debounces discoverable channel searches while `BrowseChannelsDialog` is
 * open, canceling pending timers and ignoring stale responses on cleanup.
 */
export function useBrowseChannelsSearch(
  open: boolean,
  query: string,
  t: (key: "loadError") => string,
): {
  rooms: DiscoverableChatRoom[];
  isLoading: boolean;
  clearRooms: () => void;
} {
  const [rooms, setRooms] = useState<DiscoverableChatRoom[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);
      const result = await listDiscoverableChannelsAction({ q: query });
      if (cancelled) {
        return;
      }
      setIsLoading(false);
      if (!result.ok) {
        toast.error(result.error.message || t("loadError"));
        setRooms([]);
        return;
      }
      setRooms(result.value);
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, query, t]);

  function clearRooms() {
    setRooms([]);
  }

  return { rooms, isLoading, clearRooms };
}
