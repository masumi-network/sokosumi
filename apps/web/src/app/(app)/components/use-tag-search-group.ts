"use client";

import type { TaskListItem, WorkspaceLabel } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { getDefaultTasksScope } from "@/app/tasks/utils/tasks-filters";
import { coreClient } from "@/lib/clients/core.browser.client";
import { useWorkspaceTags } from "@/queries/workspace-tags";

/**
 * The Tags group inside global search: workspace tags whose name matches
 * the query (a leading `#` is optional), and the best match's most
 * recently updated Tasks.
 * Same jump-not-page rule as the Files group: five of each at most.
 */
export const GLOBAL_SEARCH_TAGS_LIMIT = 5;

type LoadState = "loading" | "error" | "ready";

function tagNeedle(query: string) {
  return query.trim().replace(/^#/u, "").trim().toLowerCase();
}

export function matchWorkspaceTags(
  tags: WorkspaceLabel[],
  query: string,
): WorkspaceLabel[] {
  const needle = tagNeedle(query);
  if (!needle) return [];
  const rank = (tag: WorkspaceLabel) => {
    const name = tag.displayName.toLowerCase();
    if (name === needle) return 0;
    return name.startsWith(needle) ? 1 : 2;
  };
  return tags
    .filter((tag) => tag.displayName.toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, GLOBAL_SEARCH_TAGS_LIMIT);
}

export function useTagSearchGroup(input: {
  open: boolean;
  activeOrganizationId: string | null;
  debouncedQuery: string;
}): {
  tags: WorkspaceLabel[];
  /** Null while there is no tag to look for. */
  tagsState: LoadState | null;
  topTag?: WorkspaceLabel;
  tasks: TaskListItem[];
  tasksState: LoadState;
} {
  const catalog = useWorkspaceTags(input.activeOrganizationId, {
    enabled: input.open,
  });
  const tags = matchWorkspaceTags(catalog.data ?? [], input.debouncedQuery);
  const topTag = tags[0];
  const scope = getDefaultTasksScope(input.activeOrganizationId);

  const taskQuery = useQuery({
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

  return {
    tags,
    tagsState: tagNeedle(input.debouncedQuery) ? loadState(catalog) : null,
    topTag,
    tasks: topTag ? (taskQuery.data ?? []) : [],
    tasksState: loadState(taskQuery),
  };
}

function loadState(query: { isPending: boolean; isError: boolean }): LoadState {
  if (query.isError) return "error";
  return query.isPending ? "loading" : "ready";
}
