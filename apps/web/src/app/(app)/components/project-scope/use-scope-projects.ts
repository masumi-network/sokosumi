"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue } from "react";
import { orderSidebarProjects } from "@/app/components/sidebar/components/order-sidebar-projects";
import { loadMoreProjects } from "@/app/projects/actions";
import { usePinnedProjects } from "@/hooks/use-pinned-projects";
import {
  type RecentProjectsScope,
  useRecentProjectIds,
} from "@/hooks/use-recent-projects";
import { useSession } from "@/lib/auth/auth.client";

import { loadScopeProject } from "./actions";

/** One switcher row. Closed projects never become one. */
export interface ScopeProject {
  id: string;
  name: string;
  logo: string | null;
}

interface MaybeClosed extends ScopeProject {
  closedAt?: Date | string | null;
}

/** Rows for Pinned and Recent before the full list takes over. */
const SCOPE_SHORTLIST_CAP = 8;

function isOpen(project: MaybeClosed): boolean {
  return project.closedAt == null;
}

function toRow({ id, name, logo }: ScopeProject): ScopeProject {
  return { id, name, logo };
}

function useWorkspaceScope(): RecentProjectsScope | null {
  const { data: session, isPending, error } = useSession();
  if (!session || isPending || error) return null;
  return {
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? null,
  };
}

function pageQueryKey(scope: RecentProjectsScope | null, query: string) {
  return [
    "project-scope-page",
    scope?.userId ?? null,
    scope?.organizationId ?? null,
    query,
  ] as const;
}

/** Same user and workspace; the search part of the key may differ. */
function isSameScope(
  previous: readonly unknown[],
  next: ReturnType<typeof pageQueryKey>,
): boolean {
  return previous[1] === next[1] && previous[2] === next[2];
}

/**
 * The one project a trigger names. It reads rows already loaded and asks Core
 * only for a project they miss, so a closed menu loads no list.
 */
export function useSelectedScopeProject(
  selectedProjectId: string | null,
  loaded: ScopeProject[] = [],
): ScopeProject | null {
  const scope = useWorkspaceScope();
  // Rows an open menu already loaded; never a fetch of its own.
  const cachedPage = useQueryClient().getQueryData<
    Awaited<ReturnType<typeof loadMoreProjects>>
  >(pageQueryKey(scope, ""));
  const listed =
    selectedProjectId == null
      ? undefined
      : [...loaded, ...(cachedPage?.projects ?? [])].find(
          (project) => project.id === selectedProjectId,
        );

  const selected = useQuery({
    queryKey: [
      "project-scope-selected",
      scope?.userId ?? null,
      scope?.organizationId ?? null,
      selectedProjectId,
    ],
    queryFn: () => {
      if (!selectedProjectId) throw new Error("No project selected");
      return loadScopeProject({ projectId: selectedProjectId });
    },
    enabled: selectedProjectId != null && listed == null && scope != null,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (listed) return toRow(listed);
  return selected.data ? toRow(selected.data) : null;
}

/**
 * Everything a project switcher lists: Pinned, then recently visited, then
 * the workspace's projects in Core's activity order. A search asks Core, so it
 * reaches past the first page.
 */
export function useScopeProjects({
  search,
  selectedProjectId,
}: {
  search: string;
  selectedProjectId: string | null;
}) {
  const scope = useWorkspaceScope();
  const pinned = usePinnedProjects(scope);
  const visitedIds = useRecentProjectIds(scope);
  const query = useDeferredValue(search.trim());

  const page = useQuery({
    queryKey: pageQueryKey(scope, query),
    queryFn: () => {
      if (!scope) throw new Error("No workspace scope");
      return loadMoreProjects({
        cursor: null,
        query: query || undefined,
        expectedScope: scope,
      });
    },
    enabled: scope != null,
    // Keep rows while a search refines, never across a workspace switch: an
    // old workspace's project would still be clickable.
    placeholderData: (previous, previousQuery) =>
      previousQuery &&
      isSameScope(previousQuery.queryKey, pageQueryKey(scope, query))
        ? previous
        : undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const pinnedProjects = (pinned.data ?? []).filter(isOpen).map(toRow);
  const pageProjects = (page.data?.projects ?? []).filter(isOpen).map(toRow);

  const { rows: shortlist, pinnedCount } = orderSidebarProjects<ScopeProject>({
    projects: [...pinnedProjects, ...pageProjects],
    pinnedIds: pinnedProjects.map((project) => project.id),
    visitedIds,
    cap: SCOPE_SHORTLIST_CAP,
  });

  const selectedProject = useSelectedScopeProject(selectedProjectId, [
    ...pinnedProjects,
    ...pageProjects,
  ]);

  return {
    /** Shown only while the search box is empty. */
    pinned: shortlist.slice(0, pinnedCount),
    recent: shortlist.slice(pinnedCount),
    /** The workspace page, or Core's matches for the search. */
    all: pageProjects,
    selectedProject,
    isSearching: query.length > 0,
    isPending: scope == null || page.isPending || pinned.isPending,
    isError: page.isError || pinned.isError,
    refetch() {
      void page.refetch();
      void pinned.refetch();
    },
  };
}
