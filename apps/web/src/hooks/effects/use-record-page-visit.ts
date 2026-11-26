"use client";

import { useEffect, useEffectEvent } from "react";

import { recordVisit } from "@/lib/navigation/likely-pages";

/**
 * Records a page visit for `pathname` once on mount (or on an `<Activity>`
 * reveal). Callers that need a fresh visit per pathname remount with `key`.
 */
export function useRecordPageVisit(pathname: string): void {
  const recordCurrentVisit = useEffectEvent(() => {
    recordVisit(pathname);
  });

  useEffect(() => {
    recordCurrentVisit();
  }, []);
}
