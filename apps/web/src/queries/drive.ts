import type { QueryClient } from "@tanstack/react-query";
import type { DriveWorkspaceStore } from "@/lib/utils/drive-file-list.client";
import type {
  FileSearchFilterState,
  FileStore,
} from "@/lib/utils/file-search.client";
import { buildScopedQueryKey } from "@/queries/scoped-queries";

export const DRIVE_QUERY_ROOT = "drive" as const;

export interface DriveCatalogQueryParams {
  query: string;
  filters: FileSearchFilterState;
  directOnly: boolean;
  sortBy: "relevance" | "modified" | "name";
  sortOrder: "asc" | "desc";
}

export interface DriveRecentsQueryParams {
  q?: string;
  tagLabelIds?: readonly string[];
}

export function normalizeDriveStore(store: FileStore): DriveWorkspaceStore {
  return store.scope === "org" && store.organizationId
    ? { scope: "org", organizationId: store.organizationId }
    : { scope: "me" };
}

function driveKey<const TRest extends readonly unknown[]>(
  store: FileStore,
  ...rest: TRest
) {
  return buildScopedQueryKey(normalizeDriveStore(store), [
    DRIVE_QUERY_ROOT,
    ...rest,
  ] as const);
}

export const driveQueryKeys = {
  prefix: (store: FileStore) => driveKey(store),
  catalog: (store: FileStore, params: DriveCatalogQueryParams) =>
    driveKey(store, "catalog", params),
  collections: (store: FileStore) => driveKey(store, "collections"),
  dataRooms: (store: FileStore) => driveKey(store, "data-rooms"),
  dataRoom: (store: FileStore, roomId: string) =>
    driveKey(store, "data-room", roomId),
  dataRoomEvents: (store: FileStore, roomId: string, memberId: string) =>
    driveKey(store, "data-room", roomId, "events", memberId),
  dataRoomQuestions: (store: FileStore, roomId: string) =>
    driveKey(store, "data-room", roomId, "questions"),
  folders: (store: FileStore) => driveKey(store, "folders"),
  googleSheet: (store: FileStore, resourceId: string) =>
    driveKey(store, "google-sheet", resourceId),
  labels: (store: FileStore) => driveKey(store, "labels"),
  picker: (store: FileStore, params: { folder?: string; q?: string } = {}) =>
    driveKey(store, "picker", {
      folder: params.folder ?? "",
      q: params.q?.trim() ?? "",
    }),
  recents: (store: FileStore, params: DriveRecentsQueryParams = {}) =>
    driveKey(store, "recents", {
      q: params.q?.trim() ?? "",
      tagLabelIds: params.tagLabelIds?.filter(Boolean) ?? [],
    }),
  tags: (store: FileStore) => driveKey(store, "tags"),
} as const;

export function splitDriveQueryKey<const TRest extends readonly unknown[]>(
  key: readonly [DriveWorkspaceStore, typeof DRIVE_QUERY_ROOT, ...TRest],
): {
  scope: DriveWorkspaceStore;
  queryKey: readonly [typeof DRIVE_QUERY_ROOT, ...TRest];
} {
  const [scope, ...queryKey] = key;
  return { scope, queryKey };
}

export interface InvalidateDriveOptions {
  /** Resource ids, entity ids, or Drive pathnames to drop from loaded lists before refetch returns. */
  deletedIds?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInfiniteData(
  value: unknown,
): value is { pages: unknown[]; pageParams: unknown[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.pages) &&
    Array.isArray(value.pageParams)
  );
}

function removeDeletedFromArray(
  items: readonly unknown[],
  deleted: ReadonlySet<string>,
): readonly unknown[] {
  let changed = false;
  const next: unknown[] = [];

  for (const item of items) {
    if (isRecord(item)) {
      const id = typeof item.id === "string" ? item.id : null;
      const resourceId =
        typeof item.resourceId === "string" ? item.resourceId : null;
      const pathname = typeof item.pathname === "string" ? item.pathname : null;

      if (
        (id !== null && deleted.has(id)) ||
        (resourceId !== null && deleted.has(resourceId)) ||
        (pathname !== null && deleted.has(pathname))
      ) {
        changed = true;
        continue;
      }
    }

    next.push(item);
  }

  return changed ? next : items;
}

function removeDeletedFromList(
  value: unknown,
  deleted: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return removeDeletedFromArray(value, deleted);
  }
  if (isRecord(value) && Array.isArray(value.items)) {
    const nextItems = removeDeletedFromArray(value.items, deleted);
    return nextItems === value.items ? value : { ...value, items: nextItems };
  }
  return value;
}

function removeDeletedFromData(
  data: unknown,
  deleted: ReadonlySet<string>,
): unknown {
  if (isInfiniteData(data)) {
    let changed = false;
    const nextPages = data.pages.map((page) => {
      const nextPage = removeDeletedFromList(page, deleted);
      if (nextPage !== page) changed = true;
      return nextPage;
    });
    return changed ? { ...data, pages: nextPages } : data;
  }

  return removeDeletedFromList(data, deleted);
}

/**
 * Single Drive write invalidation path: runs only after a successful write.
 * Cancels in-flight reads on the store prefix (including cold keys with no data
 * yet, which `invalidateQueries` alone would reuse), removes `deletedIds` from
 * entries that have data, then invalidates the prefix.
 */
export async function invalidateDrive(
  queryClient: QueryClient,
  store: FileStore,
  options?: InvalidateDriveOptions,
): Promise<void> {
  const prefix = driveQueryKeys.prefix(store);
  await queryClient.cancelQueries({ queryKey: prefix });

  const deleted = new Set(options?.deletedIds ?? []);

  if (deleted.size > 0) {
    for (const query of queryClient
      .getQueryCache()
      .findAll({ queryKey: prefix })) {
      const current = query.state.data;
      if (current === undefined) continue;

      const next = removeDeletedFromData(current, deleted);
      if (next !== current) {
        queryClient.setQueryData(query.queryKey, next);
      }
    }
  }

  await queryClient.invalidateQueries({ queryKey: prefix });
}
