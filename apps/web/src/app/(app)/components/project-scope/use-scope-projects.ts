"use client";

import type { ProjectListItem } from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { orderSidebarProjects } from "@/app/components/sidebar/components/order-sidebar-projects";
import { getEnvPublicConfig } from "@/config/env.public";
import {
  pinnedProjectsQueryOptions,
  usePinnedProjects,
} from "@/hooks/use-pinned-projects";
import {
  type RecentProjectsScope,
  useRecentProjectIds,
} from "@/hooks/use-recent-projects";
import { useSession } from "@/lib/auth/auth.client";
import { fetchScopeList } from "@/lib/project-scope-list.client";

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

interface ScopePage {
  projects: ProjectListItem[];
  /** Null once this page holds every project the search can match. */
  nextCursor: string | null;
}

function pageQueryOptions(scope: RecentProjectsScope | null, query: string) {
  return {
    queryKey: pageQueryKey(scope, query),
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (!scope) throw new Error("No workspace scope");
      const search = query ? `?q=${encodeURIComponent(query)}` : "";
      return fetchScopeList<ScopePage>(
        `/api/project-scope${search}`,
        scope,
        signal,
      );
    },
    enabled: scope != null,
    retry: false,
    refetchOnWindowFocus: false,
  };
}

/**
 * Starts the menu's reads before it opens, from a hover or focus on the
 * trigger, so the list is there when it does.
 */
export function usePrefetchScopeProjects(): () => void {
  const queryClient = useQueryClient();
  const scope = useWorkspaceScope();
  return () => {
    if (!scope) return;
    void queryClient.prefetchQuery(pageQueryOptions(scope, ""));
    void queryClient.prefetchQuery(pinnedProjectsQueryOptions(scope));
  };
}

function matches(project: ScopeProject, needle: string): boolean {
  return project.name.toLowerCase().includes(needle);
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
  const cachedPage = useQueryClient().getQueryData<ScopePage>(
    pageQueryKey(scope, ""),
  );
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
  // Core's last answer: a failed refetch keeps it.
  return selected.data === null;
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
  // Core's answer wins, and a failed refetch keeps the last one. A listed row
  // names the project while it loads.
  if (selected.data !== undefined) {
    return selected.data ? toRow(selected.data) : null;
  }
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
  const typed = search.trim();
  const [query] = useDebounce(
    typed,
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  const firstPage = useQuery(pageQueryOptions(scope, ""));
  // A workspace whose projects all fit on the first page never asks Core to
  // search: the rows already here are every possible match.
  const complete = firstPage.data?.nextCursor === null;
  const coreQuery = complete ? "" : query;
  const searchPage = useQuery({
    ...pageQueryOptions(scope, coreQuery),
    enabled: scope != null && coreQuery.length > 0,
    // Keep rows while a search refines, never across a workspace switch: an
    // old workspace's project would still be clickable.
    placeholderData: (previous, previousQuery) =>
      previousQuery &&
      isSameScope(previousQuery.queryKey, pageQueryKey(scope, coreQuery))
        ? previous
        : undefined,
  });

  const pinnedProjects = (pinned.data ?? []).filter(isOpen).map(toRow);
  const firstPageProjects = (firstPage.data?.projects ?? [])
    .filter(isOpen)
    .map(toRow);

  const { rows: shortlist, pinnedCount } = orderSidebarProjects<ScopeProject>({
    projects: [...pinnedProjects, ...firstPageProjects],
    pinnedIds: pinnedProjects.map((project) => project.id),
    visitedIds,
    cap: SCOPE_SHORTLIST_CAP,
  });

  // Every keystroke filters the rows already loaded at once; Core's answer,
  // when one is needed, replaces them once it matches what was typed.
  const needle = typed.toLowerCase();
  const coreAnswered =
    coreQuery.length > 0 &&
    coreQuery === typed &&
    searchPage.data !== undefined &&
    !searchPage.isPlaceholderData;
  const known = [
    ...new Map(
      [...firstPageProjects, ...pinnedProjects].map((project) => [
        project.id,
        project,
      ]),
    ).values(),
  ];
  const all = !typed
    ? firstPageProjects
    : coreAnswered
      ? (searchPage.data?.projects ?? []).filter(isOpen).map(toRow)
      : known.filter((project) => matches(project, needle));

  const selectedProject = useSelectedScopeProject(selectedProjectId, known);

  return {
    /** Shown only while the search box is empty. */
    pinned: shortlist.slice(0, pinnedCount),
    recent: shortlist.slice(pinnedCount),
    /** The workspace page, or the matches for the search. */
    all,
    selectedProject,
    isSearching: typed.length > 0,
    /** Core has not answered the typed search yet; local matches show meanwhile. */
    isSearchPending: typed.length > 0 && !complete && !coreAnswered,
    isPending: scope == null || firstPage.isPending || pinned.isPending,
    isError: firstPage.isError || searchPage.isError || pinned.isError,
    refetch() {
      void firstPage.refetch();
      if (coreQuery) void searchPage.refetch();
      void pinned.refetch();
    },
  };
}
