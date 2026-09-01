"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  getDefaultHistoryScope,
  resolveHistoryApiTypes,
} from "@/app/history/utils/history-filters";
import { coreClient } from "@/lib/clients/core.browser.client";

export const HISTORY_SEARCH_PAGE_SIZE = 50;
export const HISTORY_SEARCH_DEBOUNCE_MS = 250;

interface UseHistorySearchCorpusOptions {
  open: boolean;
  activeOrganizationId: string | null;
  errorLabel: string;
}

export function historySearchCorpusQueryKey(
  activeOrganizationId: string | null,
  searchQuery: string,
) {
  const scope = getDefaultHistoryScope(activeOrganizationId);
  return [
    "history-search-corpus",
    activeOrganizationId,
    scope,
    searchQuery,
  ] as const;
}

export function useHistorySearchCorpus({
  open,
  activeOrganizationId,
  errorLabel,
}: UseHistorySearchCorpusOptions) {
  const [query, setQueryState] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const debouncedSetQuery = useDebouncedCallback((value: string) => {
    setDebouncedQuery(value.trim());
  }, HISTORY_SEARCH_DEBOUNCE_MS);

  function setQuery(value: string) {
    setQueryState(value);
    debouncedSetQuery(value);
  }

  function reset() {
    debouncedSetQuery.cancel();
    setQueryState("");
    setDebouncedQuery("");
  }

  const { data, isError, isFetching, isPending } = useQuery({
    queryKey: historySearchCorpusQueryKey(activeOrganizationId, debouncedQuery),
    queryFn: async () => {
      const response = await coreClient.getHistory({
        q: debouncedQuery || undefined,
        limit: HISTORY_SEARCH_PAGE_SIZE,
        scope: getDefaultHistoryScope(activeOrganizationId),
        types: resolveHistoryApiTypes(null),
      });
      return response.data;
    },
    enabled: open,
  });

  return {
    query,
    setQuery,
    history: data ?? [],
    error: isError ? errorLabel : null,
    isLoading: open && (isPending || isFetching),
    reset,
  };
}
