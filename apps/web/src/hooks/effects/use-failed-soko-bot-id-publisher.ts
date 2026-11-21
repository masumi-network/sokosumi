"use client";

import { useLayoutEffect } from "react";
import { publishFailedSokoBotId } from "@/components/chat/personal-assistant-chrome-store";

/**
 * Publishes the failed Soko Bot id before paint (`useLayoutEffect`) so the
 * chat list's Direct row updates in the same frame as the sidebar Soko Bot row.
 */
export function useFailedSokoBotIdPublisher(failedId: string | null): void {
  useLayoutEffect(() => {
    if (!failedId) {
      return;
    }
    return publishFailedSokoBotId(failedId);
  }, [failedId]);
}
