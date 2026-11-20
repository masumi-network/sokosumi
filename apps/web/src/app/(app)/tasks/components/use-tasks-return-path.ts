"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { getStoredTasksReturnPath } from "./task-navigation";

const subscribe = () => () => {};
const getServerSnapshot = () => null;

/**
 * Client-only tasks list return path from sessionStorage (set by TaskDetailLink).
 * Null until client sync (avoids SSR/hydration mismatch), so a caller can wait
 * for the real path before it prefetches.
 *
 * Re-reads on pathname change: the mobile header stays mounted across
 * `/tasks` → `/tasks/:id`, so a mount-only read would keep a stale `/tasks`.
 * A read made for an earlier pathname is null too, not that stale path.
 */
export function useTasksReturnPath({ allowCalendar = false } = {}) {
  const pathname = usePathname();
  return useSyncExternalStore(
    subscribe,
    () =>
      getStoredTasksReturnPath({
        taskPath: allowCalendar ? pathname : undefined,
      }),
    getServerSnapshot,
  );
}
