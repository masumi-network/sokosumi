"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import {
  buildHistoryFiltersSearchParams,
  getHistoryFiltersFromSearchParams,
  HISTORY_SEARCH_MAX_LENGTH,
  type ProjectFilterOption,
} from "@/app/history/utils/history-filters";
import { PageSearchField } from "@/components/page-search-field";
import { getEnvPublicConfig } from "@/config/env.public";

interface HistorySearchProps {
  activeOrganizationId: string | null;
  projectOptions: ProjectFilterOption[];
  labels: {
    placeholder: string;
    clear: string;
  };
}

export function HistorySearch({
  activeOrganizationId,
  projectOptions,
  labels,
}: HistorySearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(
    () =>
      getHistoryFiltersFromSearchParams(
        searchParams,
        activeOrganizationId,
        projectOptions,
      ),
    [activeOrganizationId, projectOptions, searchParams],
  );
  const [prevQuery, setPrevQuery] = useState(filters.q);
  const [searchValue, setSearchValue] = useState(filters.q ?? "");

  // Syncs local input when URL state changes via navigation or filter resets.
  if (prevQuery !== filters.q) {
    setPrevQuery(filters.q);
    setSearchValue(filters.q ?? "");
  }

  function replaceWithQuery(nextQuery: string | null) {
    const paramsForMerge = new URLSearchParams(
      typeof window !== "undefined"
        ? window.location.search
        : searchParams.toString(),
    );
    const current = getHistoryFiltersFromSearchParams(
      paramsForMerge,
      activeOrganizationId,
      projectOptions,
    );
    const nextSearchParams = buildHistoryFiltersSearchParams(
      paramsForMerge,
      {
        ...current,
        q: nextQuery,
      },
      activeOrganizationId,
    );
    const nextQueryString = nextSearchParams.toString();

    router.replace(
      nextQueryString ? `${pathname}?${nextQueryString}` : pathname,
    );
  }

  const debouncedReplaceWithQuery = useDebouncedCallback(
    replaceWithQuery,
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  function handleInputChange(next: string) {
    const capped = next.slice(0, HISTORY_SEARCH_MAX_LENGTH);
    setSearchValue(capped);
    debouncedReplaceWithQuery(capped.trim() || null);
  }

  function handleClear() {
    setSearchValue("");
    debouncedReplaceWithQuery.cancel();
    replaceWithQuery(null);
  }

  return (
    <PageSearchField
      inHeader
      maxLength={HISTORY_SEARCH_MAX_LENGTH}
      placeholder={labels.placeholder}
      clearLabel={labels.clear}
      value={searchValue}
      onValueChange={(next) => (next ? handleInputChange(next) : handleClear())}
    />
  );
}
