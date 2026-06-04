"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import {
  buildHistoryFiltersSearchParams,
  getHistoryFiltersFromSearchParams,
  HISTORY_SEARCH_MAX_LENGTH,
  type ProjectFilterOption,
} from "@/app/history/utils/history-filters";
import { Input } from "@/components/ui/input";
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
  const [searchValue, setSearchValue] = useState(filters.q ?? "");

  // Syncs local input when URL state changes via navigation or filter resets.
  useEffect(() => {
    setSearchValue(filters.q ?? "");
  }, [filters.q]);

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
    <div className="relative w-full">
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        className="pr-8 pl-8"
        maxLength={HISTORY_SEARCH_MAX_LENGTH}
        placeholder={labels.placeholder}
        value={searchValue}
        onChange={(event) => handleInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") handleClear();
        }}
      />
      {searchValue ? (
        <button
          type="button"
          aria-label={labels.clear}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={handleClear}
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
