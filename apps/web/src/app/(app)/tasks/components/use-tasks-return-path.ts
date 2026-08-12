"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getStoredTasksReturnPath } from "./task-navigation";

/**
 * Client-only tasks list return path from sessionStorage (set by TaskDetailLink).
 * Defaults to `/tasks` until client sync (avoids SSR/hydration mismatch).
 *
 * Re-reads on pathname change: the mobile header stays mounted across
 * `/tasks` → `/tasks/:id`, so a mount-only read would keep a stale `/tasks`.
 */
export function useTasksReturnPath() {
  const pathname = usePathname();
  const [returnPath, setReturnPath] = useState("/tasks");

  useEffect(() => {
    setReturnPath(getStoredTasksReturnPath());
  }, [pathname]);

  return returnPath;
}
