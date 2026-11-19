"use client";

import type { WorkspaceLabel } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import { fetchWorkspaceLabels } from "@/lib/utils/file-search.client";

export function workspaceTagsQueryKey(organizationId: string | null) {
  return [
    "drive-tag-labels",
    driveStoreForActiveWorkspace(organizationId).scope,
    organizationId,
  ] as const;
}

function activeTags(labels: WorkspaceLabel[]) {
  return labels.filter((label) => !label.archived);
}

export function useWorkspaceTags(
  organizationId: string | null,
  {
    includeArchived = false,
    enabled = true,
  }: { includeArchived?: boolean; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: workspaceTagsQueryKey(organizationId),
    queryFn: ({ signal }) =>
      fetchWorkspaceLabels({
        store: driveStoreForActiveWorkspace(organizationId),
        kind: "TAG",
        includeArchived: true,
        signal,
      }),
    select: includeArchived ? undefined : activeTags,
    staleTime: 60_000,
    enabled,
  });
}
