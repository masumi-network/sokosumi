"use client";

import { useEffect } from "react";

import { clearListHighlight } from "@/app/chat/utils/room-message-highlight";

/**
 * Drops any active landing highlight for `list` (its hold/leave timer and
 * window scroll listeners) when the list owner unmounts, hides under React
 * `<Activity>`, or switches to another list.
 */
export function useListHighlightCleanup(list: string): void {
  useEffect(() => {
    return () => {
      clearListHighlight(list);
    };
  }, [list]);
}
