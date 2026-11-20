import { getUsersByIdOrganizations } from "@sokosumi/core-client";
import { queryOptions } from "@tanstack/react-query";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import {
  type DriveWorkspaceStore,
  listDriveItems,
} from "@/lib/utils/drive-file-list.client";
import type { FilesSortBy, FilesSortOrder } from "@/lib/utils/files-sort";

export const DRIVE_ITEMS_QUERY_KEY = ["drive", "items"] as const;
export const DRIVE_ORGANIZATION_NAME_QUERY_KEY = [
  "drive",
  "organization-name",
] as const;

export function getDriveStoreScope(
  store: { scope: "me" } | { scope: "org"; organizationId?: string | null },
  viewerId: string | null,
) {
  return [
    store.scope,
    store.scope === "org" ? (store.organizationId ?? null) : null,
    viewerId,
  ] as const;
}

export async function fetchDriveOrganizationName(params: {
  userId: string | null;
  activeOrganizationId: string | null;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (!params.userId || !params.activeOrganizationId) {
    return null;
  }
  const response = await getUsersByIdOrganizations({
    client: getBrowserCoreClient(),
    path: { id: params.userId },
    ...(params.signal ? { signal: params.signal } : {}),
  });
  if (response.error || !response.data) {
    throw response.error ?? new Error("Failed to load organizations");
  }
  const orgs = response.data.data ?? [];
  const activeOrg = orgs.find((org) => org.id === params.activeOrganizationId);
  return activeOrg?.name ?? null;
}

export function getDriveItemsQueryKey(params: {
  store: DriveWorkspaceStore;
  folder: string;
  search: string;
  sortBy?: FilesSortBy;
  sortOrder?: FilesSortOrder;
}) {
  return [
    ...DRIVE_ITEMS_QUERY_KEY,
    params.store,
    params.folder,
    params.search.trim(),
    params.sortBy ?? null,
    params.sortOrder ?? null,
  ] as const;
}

export function fetchDriveItems(
  params: {
    store: DriveWorkspaceStore;
    folder: string;
    search: string;
    sortBy?: FilesSortBy;
    sortOrder?: FilesSortOrder;
  },
  signal?: AbortSignal,
) {
  return listDriveItems({
    ...params.store,
    ...(params.folder ? { folder: params.folder } : {}),
    ...(params.search.trim() ? { q: params.search.trim() } : {}),
    ...(params.sortBy ? { sortBy: params.sortBy } : {}),
    ...(params.sortOrder ? { sortOrder: params.sortOrder } : {}),
    signal,
  });
}

export function getDriveItemsQueryOptions(params: {
  store: DriveWorkspaceStore;
  folder: string;
  search: string;
  sortBy?: FilesSortBy;
  sortOrder?: FilesSortOrder;
}) {
  return queryOptions({
    queryKey: getDriveItemsQueryKey(params),
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => fetchDriveItems(params, signal),
  });
}
