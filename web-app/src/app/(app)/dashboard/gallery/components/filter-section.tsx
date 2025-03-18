"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEYBOARD_INPUT_DEBOUNCE_TIME } from "@/constants";

import Tags from "./tags";

interface FilterState {
  query: string;
  tags: string[];
}

function useGalleryFilter() {
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

export default function FilterSection() {
  const t = useTranslations("App.Gallery.FilterSection");
  const { query, tags, setQuery, setTags, resetFilters } = useGalleryFilter();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{t("header")}</h1>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex gap-4">
          <Input
            className="max-w-64 min-w-36"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Tags tags={tags} onChange={setTags} />
        </div>
        <Button
          variant="ghost"
          onClick={resetFilters}
          className="gap-2 text-lg"
          disabled={!query && tags.length === 0}
        >
          {t("reset")}
          <X />
        </Button>
      </div>
    </div>
  );
}
