"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { orderSidebarProjects } from "@/app/components/sidebar/components/order-sidebar-projects";
import { loadMoreProjects } from "@/app/projects/actions";
import { getEnvPublicConfig } from "@/config/env.public";
import { usePinnedProjects } from "@/hooks/use-pinned-projects";
import {
  type RecentProjectsScope,
  useRecentProjectIds,
} from "@/hooks/use-recent-projects";
import { useSession } from "@/lib/auth/auth.client";

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

/** Root of the scoped project's cache key, for a refresh after navigation. */
export const SCOPE_SELECTED_QUERY_KEY = "project-scope-selected";

/**
 * Reads one project through a Route Handler, not a server action: triggers
 * read it on mount, and Next serializes server actions per session.
 */
async function fetchScopeProject(
  projectId: string,
): Promise<ScopeProject | null> {
  const response = await fetch(
    `/api/project-scope/${encodeURIComponent(projectId)}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Project scope read failed: ${response.status}`);
  }
  const body = (await response.json()) as { project: ScopeProject | null };
  return body.project;
}

function useSelectedProjectQuery(
  selectedProjectId: string | null,
  loaded: ScopeProject[],
) {
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
      SCOPE_SELECTED_QUERY_KEY,
      scope?.userId ?? null,
      scope?.organizationId ?? null,
      selectedProjectId,
    ],
    queryFn: () => {
      if (!selectedProjectId) throw new Error("No project selected");
      return fetchScopeProject(selectedProjectId);
    },
    // Always asked, even when a list has the row: a rename shows up here
    // once the guard marks this stale on navigation.
    enabled: selectedProjectId != null && scope != null,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { listed, selected };
}

/**
 * True once Core says the scoped project is not in this workspace, as after
 * a workspace switch that kept the URL, or a stale shared link.
 */
export function useIsUnknownScopeProject(
  selectedProjectId: string | null,
): boolean {
  const { selected } = useSelectedProjectQuery(selectedProjectId, []);
  return selected.isSuccess && selected.data === null;
}

/**
 * The one project a trigger names. It reads that project alone, so a closed
 * menu loads no list; rows already loaded name it in the meantime.
 */
export function useSelectedScopeProject(
  selectedProjectId: string | null,
  loaded: ScopeProject[] = [],
): ScopeProject | null {
  const { listed, selected } = useSelectedProjectQuery(
    selectedProjectId,
    loaded,
  );
  // Core's answer wins; a listed row names the project while it loads.
  if (selected.isSuccess) return selected.data ? toRow(selected.data) : null;
  return listed ? toRow(listed) : null;
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
  // One Core search per pause in typing, not one per keystroke.
  const [query] = useDebounce(
    search.trim(),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

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
