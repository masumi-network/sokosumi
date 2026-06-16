"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { Input } from "@/components/ui/input";
import { getEnvPublicConfig } from "@/config/env.public";
import { jobMatchesQuery, type SearchableJob } from "@/lib/job";
import type { JobSummary } from "@/lib/types/core-dto";

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

interface JobsSearchProps {
  jobs: JobSummary[];
  onFilteredChange?: (filtered: JobSummary[], query: string) => void;
}

export function JobsSearch({ jobs, onFilteredChange }: JobsSearchProps) {
  const t = useTranslations("Components.Jobs.JobsSearch");

  const [queryParam, setQueryParam] = useQueryState("query", {
    defaultValue: "",
  });

  const [searchValue, setSearchValue] = useState<string>(queryParam);

  useEffect(() => {
    setSearchValue(queryParam);
  }, [queryParam]);

  const debouncedSetQuery = useDebouncedCallback(
    (next: string) => setQueryParam(next),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  const matcher = useMemo(() => jobMatchesQuery, []);

  const filteredJobs = useMemo(() => {
    const q = searchValue.trim();
    if (!q || q.length > MAX_QUERY_LENGTH) return jobs;
    return jobs.filter((j) => matcher(toSearchableJob(j), q));
  }, [jobs, searchValue, matcher]);

  useEffect(() => {
    onFilteredChange?.(filteredJobs, searchValue);
  }, [filteredJobs, searchValue, onFilteredChange]);

  function handleInputChange(next: string) {
    const trimmed = next.slice(0, MAX_QUERY_LENGTH);
    setSearchValue(trimmed);
    debouncedSetQuery(trimmed);
  }

  function handleClear() {
    setSearchValue("");
    setQueryParam("");
  }

  return (
    <div className="flex w-full flex-col items-start justify-between px-2 pb-2 md:flex-row md:items-center md:px-0 md:pr-4">
      <div className="relative w-full">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
        <Input
          className="pr-8 pl-8"
          placeholder={t("placeholder")}
          value={searchValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleClear();
          }}
        />
        {searchValue ? (
          <button
            aria-label={t("clear")}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition outline-none"
            onClick={handleClear}
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {searchValue && (
        <div className="text-muted-foreground px-1 text-xs whitespace-nowrap md:text-sm">
          {t("resultsCount", {
            found: filteredJobs.length,
            total: jobs.length,
          })}
        </div>
      )}
    </div>
  );
}
