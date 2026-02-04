"use client";

import { useCallback } from "react";

import { extractMessageContent } from "@/app/chat/utils/message-utils";

/**
 * Hook to extract message content for rendering
 * Handles various message formats (AI SDK v6, parts array, etc.)
 */
export function useMessageContent() {
  const extractContent = useCallback((message: unknown): string => {
    return extractMessageContent(message);
  }, []);

  return { extractContent };
}
