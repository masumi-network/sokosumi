import { queryOptions } from "@tanstack/react-query";
import {
  type DriveWorkspaceStore,
  listDriveItems,
} from "@/lib/utils/drive-file-list.client";

export const DRIVE_ITEMS_QUERY_KEY = ["drive", "items"] as const;

export function getDriveItemsQueryKey(params: {
  store: DriveWorkspaceStore;
  folder: string;
  search: string;
}) {
  return [
    ...DRIVE_ITEMS_QUERY_KEY,
    params.store,
    params.folder,
    params.search,
  ] as const;
}

export function getDriveItemsQueryOptions(params: {
  store: DriveWorkspaceStore;
  folder: string;
  search: string;
}) {
  return queryOptions({
    queryKey: getDriveItemsQueryKey(params),
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      listDriveItems({
        ...params.store,
        ...(params.folder ? { folder: params.folder } : {}),
        ...(params.search.trim() ? { q: params.search.trim() } : {}),
        signal,
      }),
  });
}
