"use client";

import { useEffect } from "react";

/** While the tab is open it reads again this often, so Cuso's new ideas show up. */
const REFRESH_MS = 20_000;

export function useSeoPageRefresh(refresh: () => Promise<void> | void): void {
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
}
