"use client";

import { useWorkspaceScope } from "@/app/components/project-scope/use-scope-projects";
import type { BriefingCopySource } from "@/app/projects/project-briefing";
import { fetchScopeList } from "@/lib/project-scope-list.client";
import { useScopedInfiniteQuery } from "@/queries/scoped-queries";

interface SourcesPage {
  sources: BriefingCopySource[];
  nextCursor: string | null;
}

/**
 * The Copy from a project menu's rows: read only while the menu is open, a
 * page at a time, and never the target project itself.
 */
export function useBriefingCopySources(open: boolean, targetId: string) {
  const scope = useWorkspaceScope();
  const query = useScopedInfiniteQuery({
    scope,
    queryKey: ["briefing-copy-sources"],
    queryFn: ({ pageParam, signal }) => {
      if (!scope) throw new Error("No workspace scope");
      const search = pageParam
        ? `?cursor=${encodeURIComponent(pageParam)}`
        : "";
      return fetchScopeList<SourcesPage>(
        `/api/project-scope/briefings${search}`,
        scope,
        signal,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: open && scope != null,
    staleTime: 0,
  });
  const sources =
    query.data?.pages
      .flatMap((page) => page.sources)
      .filter((source) => source.id !== targetId) ?? [];

  /** The picked project's briefing, read only once it is picked. */
  async function readBriefing(projectId: string): Promise<string | null> {
    if (!scope) throw new Error("No workspace scope");
    const data = await fetchScopeList<{ briefing: string | null }>(
      `/api/project-scope/${encodeURIComponent(projectId)}/briefing`,
      scope,
    );
    return data.briefing;
  }

  return { query, sources, readBriefing };
}
