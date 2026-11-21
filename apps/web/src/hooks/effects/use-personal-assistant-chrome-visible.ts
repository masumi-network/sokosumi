"use client";

import { useEffect } from "react";
import { publishPersonalAssistantChromeVisible } from "@/components/chat/personal-assistant-chrome-store";

/**
 * Records that Personal Assistant chrome mounted in this session so Instant
 * `/chat` can reserve the row without layout jump (SOK-903).
 */
export function usePersonalAssistantChromeVisible(): void {
  useEffect(() => {
    // Session memory for Instant `/chat` (SOK-903): mount means the row is shown.
    publishPersonalAssistantChromeVisible(true);
  }, []);
}
