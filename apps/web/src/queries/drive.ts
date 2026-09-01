import { queryOptions } from "@tanstack/react-query";
import {
  type DriveWorkspaceStore,
  listDriveItems,
} from "@/lib/utils/drive-file-list.client";
import type { FilesSortBy, FilesSortOrder } from "@/lib/utils/files-sort";

export const DRIVE_ITEMS_QUERY_KEY = ["drive", "items"] as const;

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
    queryFn: ({ signal }) =>
      listDriveItems({
        ...params.store,
        ...(params.folder ? { folder: params.folder } : {}),
        ...(params.search.trim() ? { q: params.search.trim() } : {}),
        ...(params.sortBy ? { sortBy: params.sortBy } : {}),
        ...(params.sortOrder ? { sortOrder: params.sortOrder } : {}),
        signal,
      }),
  });
}
