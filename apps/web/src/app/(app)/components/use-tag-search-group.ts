"use client";

import type { TaskListItem, WorkspaceLabel } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { coreClient } from "@/lib/clients/core.browser.client";
import { useWorkspaceTags } from "@/queries/workspace-tags";

/**
 * The Tags group inside global search: workspace tags whose name matches
 * the query (a leading `#` is optional), and the first one's newest Tasks.
 * Same jump-not-page rule as the Files group: five of each at most.
 */
export const GLOBAL_SEARCH_TAGS_LIMIT = 5;

export function matchWorkspaceTags(
  tags: WorkspaceLabel[],
  query: string,
): WorkspaceLabel[] {
  const needle = query.trim().replace(/^#/u, "").trim().toLowerCase();
  if (!needle) return [];
  const rank = (tag: WorkspaceLabel) =>
    tag.displayName.toLowerCase().startsWith(needle) ? 0 : 1;
  return tags
    .filter((tag) => tag.displayName.toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, GLOBAL_SEARCH_TAGS_LIMIT);
}

export function useTagSearchGroup(input: {
  open: boolean;
  activeOrganizationId: string | null;
  debouncedQuery: string;
}): { tags: WorkspaceLabel[]; topTag?: WorkspaceLabel; tasks: TaskListItem[] } {
  const { data } = useWorkspaceTags(input.activeOrganizationId, {
    enabled: input.open,
  });
  const tags = matchWorkspaceTags(data ?? [], input.debouncedQuery);
  const topTag = tags[0];
  const scope = input.activeOrganizationId ? "workspace" : "owned";

  const { data: tasks } = useQuery({
    queryKey: [
      "tag-search-group-tasks",
      input.activeOrganizationId,
      topTag?.id,
    ],
    queryFn: async () => {
      const response = await coreClient.getTasks({
        workspaceTagId: topTag?.id,
        scope,
        sort: "updatedAt",
        limit: GLOBAL_SEARCH_TAGS_LIMIT,
      });
      return response.data;
    },
    enabled: input.open && topTag !== undefined,
  });

  return { tags, topTag, tasks: topTag ? (tasks ?? []) : [] };
}
