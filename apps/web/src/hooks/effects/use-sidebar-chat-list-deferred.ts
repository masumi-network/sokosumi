"use client";

import { useEffect, useState } from "react";

import type { SidebarChatListDeferred } from "@/app/components/private-sidebar-cache";

// Answers by promise, so a list that mounts again (the phone's sheet reopens)
// starts with what the promise already gave and not one render behind it.
const settledAnswers = new WeakMap<
  Promise<SidebarChatListDeferred>,
  SidebarChatListDeferred
>();

/**
 * Resolves the deferred archived rooms and owner/admin flag for `SidebarChatList`
 * without suspending the active room rows.
 *
 * Keeps the last settled answer while a refreshed promise is pending, ignores
 * late answers from replaced promises, and preserves existing rows on failure.
 */
export function useSidebarChatListDeferred(
  deferred: Promise<SidebarChatListDeferred>,
): SidebarChatListDeferred | null {
  const [settled, setSettled] = useState<SidebarChatListDeferred | null>(
    () => settledAnswers.get(deferred) ?? null,
  );
  useEffect(() => {
    let current = true;
    deferred.then(
      (value) => {
        settledAnswers.set(deferred, value);
        if (current) setSettled(value);
      },
      // The read failed or the stream closed before the answer arrived. The
      // rows stay, without the Archived section and the owner/admin menus,
      // until the layout is next refreshed. No refresh from here: it re-runs
      // the whole app frame, which fails closed when Core is slow.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [deferred]);

  return settled;
}
