"use client";

import type { JobSummary } from "@sokosumi/core-client";
import { Search, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { PageSearchHint } from "@/components/page-search-field";
import { Input } from "@/components/ui/input";
import { getEnvPublicConfig } from "@/config/env.public";
import { usePageSearchShortcut } from "@/hooks/effects/use-page-search-shortcut";
import { jobMatchesQuery, type SearchableJob } from "@/lib/job/job-search";
import { cn } from "@/lib/utils";

const MAX_QUERY_LENGTH = 256;

function toSearchableJob(job: JobSummary): SearchableJob {
  return {
    id: job.id,
    name: job.name ?? null,
    events: job.result
      ? [
          {
            input: null,
            result: job.result,
          },
        ]
      : [],
  };
}

export function filterJobsByQuery(
  jobs: JobSummary[],
  query: string,
): JobSummary[] {
  const q = query.trim();
  if (!q || q.length > MAX_QUERY_LENGTH) return jobs;
  return jobs.filter((j) => jobMatchesQuery(toSearchableJob(j), q));
}

export function useJobsSearchQuery() {
  const [queryParam, setQueryParam] = useQueryState("query", {
    defaultValue: "",
  });

  const [prevQueryParam, setPrevQueryParam] = useState(queryParam);
  const [searchValue, setSearchValue] = useState<string>(queryParam);

  if (prevQueryParam !== queryParam) {
    setPrevQueryParam(queryParam);
    setSearchValue(queryParam);
  }

  const debouncedSetQuery = useDebouncedCallback(
    (next: string) => setQueryParam(next),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  function handleInputChange(next: string) {
    const trimmed = next.slice(0, MAX_QUERY_LENGTH);
    setSearchValue(trimmed);
    debouncedSetQuery(trimmed);
  }

  function handleClear() {
    debouncedSetQuery.cancel();
    setSearchValue("");
    void setQueryParam("");
  }

  return {
    searchValue,
    handleInputChange,
    handleClear,
  };
}

interface JobsSearchProps {
  searchValue: string;
  onSearchChange: (next: string) => void;
  onClear: () => void;
  filteredCount: number;
  totalCount: number;
  /** True when older jobs exist beyond the loaded pages (load-more available). */
  hasMoreHistory?: boolean;
}

export function JobsSearch({
  searchValue,
  onSearchChange,
  onClear,
  filteredCount,
  totalCount,
  hasMoreHistory = false,
}: JobsSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  usePageSearchShortcut(inputRef, { focusOnMount: pathname.endsWith("/jobs") });
  const t = useTranslations("Components.Jobs.JobsSearch");

  function handleClear() {
    onClear();
    inputRef.current?.focus();
  }

  return (
    <div className="flex w-full flex-col items-start gap-1 px-2 pb-2 md:px-0 md:pr-4">
      <div className="@container/page-search relative w-full">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
        <Input
          ref={inputRef}
          aria-label={t("placeholder")}
          aria-keyshortcuts="Meta+F Control+F"
          className={cn(
            "pr-8 pl-8",
            searchValue
              ? "pointer-fine:@min-[14rem]/page-search:pe-24"
              : "pointer-fine:@min-[14rem]/page-search:pe-16",
          )}
          placeholder={t("placeholder")}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleClear();
          }}
        />
        {searchValue ? (
          <button
            aria-label={t("clear")}
            className="text-muted-foreground press hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 hit-area absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition-[color,background-color,border-color,transform] outline-none"
            onClick={handleClear}
          >
            <X className="size-4" />
          </button>
        ) : null}
        <PageSearchHint
          className={cn(
            "absolute top-1/2 -translate-y-1/2",
            searchValue ? "end-10" : "end-3",
          )}
        />
      </div>
      {searchValue ? (
        <div className="text-muted-foreground flex flex-col gap-0.5 px-1 text-xs">
          <span className="whitespace-nowrap">
            {t(hasMoreHistory ? "resultsCountLoaded" : "resultsCount", {
              found: filteredCount,
              total: totalCount,
            })}
          </span>
          {hasMoreHistory ? (
            <span className="text-xs">{t("loadedOnlyHint")}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
