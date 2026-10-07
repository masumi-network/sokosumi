"use client";

import type { FileResource } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  EMPTY_FILE_FILTERS,
  type FileStore,
  fetchFileSearchPage,
} from "@/lib/utils/file-search.client";

/**
 * The Files group inside global search.
 *
 * It shares the dialog's debounced query rather than fetching per keystroke,
 * and React Query's key carries the workspace, so a result from one
 * workspace can never be rendered under another. Five results, then "See all
 * files" — the dialog is a jump, not a second Files page.
 */

export const GLOBAL_SEARCH_FILES_LIMIT = 5;

export function fileSearchGroupQueryKey(
  activeOrganizationId: string | null,
  searchQuery: string,
) {
  return ["file-search-group", activeOrganizationId, searchQuery] as const;
}

export function useFileSearchGroup(input: {
  open: boolean;
  activeOrganizationId: string | null;
  debouncedQuery: string;
}): { files: FileResource[]; isLoading: boolean; isError: boolean } {
  const driveStore = driveStoreForActiveWorkspace(input.activeOrganizationId);
  const store: FileStore =
    driveStore.scope === "org"
      ? { scope: "org", organizationId: driveStore.organizationId }
      : { scope: "me" };

  const { data, isError, isFetching, isPending } = useQuery({
    queryKey: fileSearchGroupQueryKey(
      input.activeOrganizationId,
      input.debouncedQuery,
    ),
    queryFn: async ({ signal }) => {
      const page = await fetchFileSearchPage({
        store,
        query: input.debouncedQuery,
        filters: { ...EMPTY_FILE_FILTERS },
        sortBy:
          input.debouncedQuery.trim().length > 0 ? "relevance" : "modified",
        sortOrder: "desc",
        signal,
      });
      return page.items.slice(0, GLOBAL_SEARCH_FILES_LIMIT);
    },
    // No file fetch until there is something to look for.
    enabled: input.open && input.debouncedQuery.trim().length > 0,
  });

  return {
    files: data ?? [],
    isLoading:
      input.open &&
      input.debouncedQuery.trim().length > 0 &&
      (isPending || isFetching),
    isError,
  };
}
