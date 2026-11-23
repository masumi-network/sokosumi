"use client";

import type { WorkspaceLabel } from "@sokosumi/core-client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import { fetchWorkspaceLabels } from "@/lib/utils/file-search.client";
import { driveQueryKeys, splitDriveQueryKey } from "@/queries/drive";
import { useScopedQuery } from "@/queries/scoped-queries";

export function workspaceTagsQueryKey(organizationId: string | null) {
  return driveQueryKeys.tags(driveStoreForActiveWorkspace(organizationId));
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
  const store = driveStoreForActiveWorkspace(organizationId);
  return useScopedQuery({
    ...splitDriveQueryKey(driveQueryKeys.tags(store)),
    queryFn: ({ signal }) =>
      fetchWorkspaceLabels({
        store,
        kind: "TAG",
        includeArchived: true,
        signal,
      }),
    select: includeArchived ? undefined : activeTags,
    staleTime: 60_000,
    enabled,
  });
}
