"use client";

import { useEffect } from "react";

import { recordVisit } from "@/lib/navigation/likely-pages";

/**
 * Records a page visit for `pathname` in the likely-pages visit counter.
 */
export function useRecordPageVisit(pathname: string): void {
  useEffect(() => {
    recordVisit(pathname);
  }, [pathname]);
}
