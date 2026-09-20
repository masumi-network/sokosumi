"use client";

import { Search, X } from "lucide-react";
import { useQueryState } from "nuqs";
import { useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { Input } from "@/components/ui/input";
import { getEnvPublicConfig } from "@/config/env.public";

/** Matches the Core route's own bound on `q`. */
const MAX_QUERY_LENGTH = 200;

export interface ProjectsFilterLabels {
  placeholder: string;
  clear: string;
}

interface ProjectsFilterProps {
  labels: ProjectsFilterLabels;
}

/**
 * Drives the `q` search param, which the server page forwards to Core. The
 * list pages with "Load more", so filtering client-side would only ever
 * search the pages already fetched — a name on a later page would look like
 * no match at all. `shallow: false` is what makes the server refetch.
 */
export function ProjectsFilter({ labels }: ProjectsFilterProps) {
  const [queryParam, setQueryParam] = useQueryState("q", {
    defaultValue: "",
    shallow: false,
    clearOnDefault: true,
  });
  const [value, setValue] = useState(queryParam);

  useEffect(() => {
    setValue(queryParam);
  }, [queryParam]);

  const debouncedSetQuery = useDebouncedCallback(
    (next: string) => setQueryParam(next),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  function handleChange(next: string) {
    const trimmed = next.slice(0, MAX_QUERY_LENGTH);
    setValue(trimmed);
    debouncedSetQuery(trimmed);
  }

  function handleClear() {
    setValue("");
    debouncedSetQuery.cancel();
    setQueryParam("");
  }

  return (
    <div className="relative w-full">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        className="h-8 pr-8 pl-8"
        placeholder={labels.placeholder}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") handleClear();
        }}
      />
      {value ? (
        <button
          type="button"
          aria-label={labels.clear}
          onClick={handleClear}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition outline-none"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
