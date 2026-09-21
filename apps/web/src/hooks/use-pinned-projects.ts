"use client";

import { useQuery } from "@tanstack/react-query";
import { loadPinnedProjects } from "@/app/projects/actions";
import type { RecentProjectsScope } from "@/hooks/use-recent-projects";

/**
 * Root of the cache key for the reader's Pinned projects. Every surface that
 * shows a Pin reads the same entry, so one fetch serves the sidebar flyout and
 * the project header, and invalidating this root updates both at once.
 */
export const PINNED_PROJECTS_QUERY_KEY = "sidebar-pinned-projects" as const;

export function pinnedProjectsQueryKey(scope: RecentProjectsScope | null) {
  return [
    PINNED_PROJECTS_QUERY_KEY,
    scope?.userId ?? null,
    scope?.organizationId ?? null,
  ];
}

/**
 * The reader's Pinned projects, oldest Pin first.
 *
 * Fetched apart from the activity page on purpose: a Pinned project is usually
 * a quiet one, so it is regularly absent from page one and would be invisible
 * to anything that only looked there (ADR-0036).
 */
export function usePinnedProjects(scope: RecentProjectsScope | null) {
  return useQuery({
    queryKey: pinnedProjectsQueryKey(scope),
    queryFn: () => {
      // `enabled` keeps this from running; the guard is what proves it to the
      // type system without an assertion.
      if (!scope) throw new Error("No workspace scope");
      return loadPinnedProjects({ expectedScope: scope });
    },
    enabled: scope != null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
