"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getStoredTasksReturnPath } from "./task-navigation";

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
  const readFor = `${pathname}|${allowCalendar}`;
  const [read, setRead] = useState<{ for: string; path: string } | null>(null);

  useEffect(() => {
    setRead({
      for: `${pathname}|${allowCalendar}`,
      path: getStoredTasksReturnPath({
        taskPath: allowCalendar ? pathname : undefined,
      }),
    });
  }, [pathname, allowCalendar]);

  return read?.for === readFor ? read.path : null;
}
