"use client";

import type { TransitionStartFunction } from "react";
import { PageQuerySearchField } from "@/components/page-query-search-field";

/** Matches the Core route's own bound on `q`. */
const MAX_QUERY_LENGTH = 200;

export interface ProjectsFilterLabels {
  placeholder: string;
  clear: string;
}

interface ProjectsFilterProps {
  labels: ProjectsFilterLabels;
  /** `ProjectsView`'s transition, so the list shows it is loading. */
  startTransition: TransitionStartFunction;
}

/**
 * Drives the `q` search param, which the server page forwards to Core. The
 * list pages with "Load more", so filtering client-side would only ever
 * search the pages already fetched — a name on a later page would look like
 * no match at all. `shallow: false` is what makes the server refetch.
 * `startTransition` keeps the current tree (and this field) visible instead
 * of swapping the page Suspense fallback in while Core runs.
 */
export function ProjectsFilter({
  labels,
  startTransition,
}: ProjectsFilterProps) {
  return (
    <PageQuerySearchField
      className="min-w-0 flex-1 basis-full sm:basis-0"
      placeholder={labels.placeholder}
      clearLabel={labels.clear}
      startTransition={startTransition}
      maxLength={MAX_QUERY_LENGTH}
    />
  );
}
