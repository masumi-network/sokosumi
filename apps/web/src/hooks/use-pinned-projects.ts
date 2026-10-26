"use client";

import type { StarredProject } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import type { RecentProjectsScope } from "@/hooks/use-recent-projects";
import { fetchScopeList } from "@/lib/project-scope-list.client";

/**
 * Root of the cache key for the reader's Pinned projects. Every surface that
 * shows a Pin reads the same entry, so one fetch serves the sidebar flyout and
 * the project header, and invalidating this root updates both at once.
 */
export const PINNED_PROJECTS_QUERY_KEY = "sidebar-pinned-projects" as const;

export function pinnedProjectsQueryOptions(scope: RecentProjectsScope | null) {
  return {
    queryKey: pinnedProjectsQueryKey(scope),
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      // `enabled` keeps this from running; the guard is what proves it to the
      // type system without an assertion.
      if (!scope) throw new Error("No workspace scope");
      return fetchScopeList<StarredProject[]>(
        "/api/project-scope/pinned",
        scope,
        signal,
      );
    },
    enabled: scope != null,
    retry: false,
  };
}

function pinnedProjectsQueryKey(scope: RecentProjectsScope | null) {
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
    ...pinnedProjectsQueryOptions(scope),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
