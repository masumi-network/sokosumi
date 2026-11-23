"use client";

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";

export interface UseTalkingVideoHistoryCancelOptions {
  searching: boolean;
  queryClient: Pick<QueryClient, "cancelQueries">;
  historyKey: QueryKey;
}

/**
 * Cancels in-flight TikTok Studio talking-video history queries when the user
 * clears the search term.
 */
export function useTalkingVideoHistoryCancel({
  searching,
  queryClient,
  historyKey,
}: UseTalkingVideoHistoryCancelOptions): void {
  useEffect(() => {
    if (!searching)
      void queryClient.cancelQueries({ queryKey: historyKey, exact: true });
  }, [searching, queryClient, historyKey]);
}
