import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { KEYBOARD_INPUT_DEBOUNCE_TIME } from "@/constants";

export interface FilterState {
  query: string;
  tags: string[];
}

export default function useGalleryFilter() {
  const { replace } = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize state from URL parameters
  const [filterState, setFilterState] = useState<FilterState>({
    query: searchParams.get("query") ?? "",
    tags: searchParams.get("tags")?.split(",").filter(Boolean) ?? [],
  });

  // Update URL parameters when filter state changes
  const updateUrlParams = useCallback(
    (newState: FilterState) => {
      const params = new URLSearchParams(searchParams);

      // Update query parameter
      if (newState.query) {
        params.set("query", newState.query.trim());
      } else {
        params.delete("query");
      }

      // Update tags parameter
      if (newState.tags.length > 0) {
        params.set("tags", newState.tags.join(","));
      } else {
        params.delete("tags");
      }

      replace(`${pathname}?${params.toString()}`);
    },
    [pathname, searchParams, replace],
  );

  const debouncedUpdateUrl = useDebouncedCallback(
    updateUrlParams,
    KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  // Update handlers
  const setQuery = useCallback(
    (query: string) => {
      setFilterState((prev) => {
        const newState = { ...prev, query };
        debouncedUpdateUrl(newState);
        return newState;
      });
    },
    [debouncedUpdateUrl],
  );

  const setTags = useCallback(
    (tags: string[]) => {
      setFilterState((prev) => {
        const newState = { ...prev, tags };
        debouncedUpdateUrl(newState);
        return newState;
      });
    },
    [debouncedUpdateUrl],
  );

  const resetFilters = useCallback(() => {
    setFilterState({ query: "", tags: [] });
    replace(pathname);
  }, [pathname, replace]);

  return {
    query: filterState.query,
    tags: filterState.tags,
    setQuery,
    setTags,
    resetFilters,
  };
}
