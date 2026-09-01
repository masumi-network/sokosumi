"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  getDefaultHistoryScope,
  resolveHistoryApiTypes,
} from "@/app/history/utils/history-filters";
import { coreClient } from "@/lib/clients/core.browser.client";
import type { HistoryItem } from "@/lib/clients/generated/core/types.gen";

export const HISTORY_SEARCH_PAGE_SIZE = 50;
export const HISTORY_SEARCH_DEBOUNCE_MS = 250;

interface UseHistorySearchCorpusOptions {
  open: boolean;
  activeOrganizationId: string | null;
  errorLabel: string;
}

export function useHistorySearchCorpus({
  open,
  activeOrganizationId,
  errorLabel,
}: UseHistorySearchCorpusOptions) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadHistory = useEffectEvent(async (searchQuery: string) => {
    const requestId = ++requestIdRef.current;
    const scope = getDefaultHistoryScope(activeOrganizationId);
    setIsLoading(true);
    setError(null);
    setHistory([]);

    try {
      const response = await coreClient.getHistory({
        q: searchQuery || undefined,
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope,
        types: resolveHistoryApiTypes(null),
      });

      if (requestId !== requestIdRef.current) return;

      setHistory(response.data);
    } catch {
      if (requestId !== requestIdRef.current) return;

      setHistory([]);
      setError(errorLabel);
    } finally {
      if (requestId !== requestIdRef.current) return;

      setIsLoading(false);
    }
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, HISTORY_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (!open) return;

    void loadHistory(debouncedQuery);
  }, [activeOrganizationId, debouncedQuery, open]);

  function reset() {
    setQuery("");
    setDebouncedQuery("");
    setHistory([]);
    setError(null);
    setIsLoading(false);
    requestIdRef.current += 1;
  }

  return {
    query,
    setQuery,
    history,
    error,
    isLoading,
    reset,
  };
}
