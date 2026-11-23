import type { QueryClient } from "@tanstack/react-query";
import type { DriveWorkspaceStore } from "@/lib/utils/drive-file-list.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import { buildScopedQueryKey } from "@/queries/scoped-queries";

export const DRIVE_QUERY_ROOT = "drive" as const;

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
  dataRooms: (store: FileStore) => driveKey(store, "data-rooms"),
  dataRoom: (store: FileStore, roomId: string) =>
    driveKey(store, "data-room", roomId),
  dataRoomEvents: (store: FileStore, roomId: string, memberId: string) =>
    driveKey(store, "data-room", roomId, "events", memberId),
  dataRoomQuestions: (store: FileStore, roomId: string) =>
    driveKey(store, "data-room", roomId, "questions"),
  googleSheet: (store: FileStore, resourceId: string) =>
    driveKey(store, "google-sheet", resourceId),
  picker: (store: FileStore, params: { folder?: string; q?: string } = {}) =>
    driveKey(store, "picker", {
      folder: params.folder ?? "",
      q: params.q?.trim() ?? "",
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
  /** Resource ids, entity ids, Drive file pathnames, or folder paths to drop from loaded lists before refetch returns. */
  deletedIds?: readonly string[];
}

const DRIVE_OWNER_PREFIX_RE = /^drive\/(?:users|organizations|orgs)\/[^/]+\//;

function stripDriveOwnerPrefix(path: string): string {
  return path.replace(DRIVE_OWNER_PREFIX_RE, "");
}

function normalizeDeletedEntry(entry: string): string {
  return entry.endsWith("/") ? entry.slice(0, -1) : entry;
}

function matchesDeletedPath(
  candidate: string,
  deleted: ReadonlySet<string>,
  deletedPrefixes: readonly string[],
): boolean {
  const relative = stripDriveOwnerPrefix(candidate);
  if (deleted.has(candidate) || deleted.has(relative)) {
    return true;
  }
  return deletedPrefixes.some(
    (prefix) => candidate.startsWith(prefix) || relative.startsWith(prefix),
  );
}

function pickerQueryFolder(queryKey: readonly unknown[]): string {
  const params = queryKey[2] === "picker" ? queryKey[3] : null;
  return isRecord(params) && typeof params.folder === "string"
    ? params.folder
    : "";
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
  deletedPrefixes: readonly string[],
  queryFolder: string,
): readonly unknown[] {
  let changed = false;
  const next: unknown[] = [];

  for (const item of items) {
    if (isRecord(item)) {
      const id = typeof item.id === "string" ? item.id : null;
      const resourceId =
        typeof item.resourceId === "string" ? item.resourceId : null;
      const pathname = typeof item.pathname === "string" ? item.pathname : null;
      const folderPath =
        item.type === "folder" && typeof item.path === "string"
          ? queryFolder
            ? `${queryFolder}/${item.path}`
            : item.path
          : null;

      if (
        (id !== null && deleted.has(id)) ||
        (resourceId !== null && deleted.has(resourceId)) ||
        (pathname !== null &&
          matchesDeletedPath(pathname, deleted, deletedPrefixes)) ||
        (folderPath !== null &&
          matchesDeletedPath(folderPath, deleted, deletedPrefixes))
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
  deletedPrefixes: readonly string[],
  queryFolder: string,
): unknown {
  if (Array.isArray(value)) {
    return removeDeletedFromArray(value, deleted, deletedPrefixes, queryFolder);
  }
  if (isRecord(value) && Array.isArray(value.items)) {
    const nextItems = removeDeletedFromArray(
      value.items,
      deleted,
      deletedPrefixes,
      queryFolder,
    );
    return nextItems === value.items ? value : { ...value, items: nextItems };
  }
  return value;
}

function removeDeletedFromData(
  data: unknown,
  deleted: ReadonlySet<string>,
  deletedPrefixes: readonly string[],
  queryFolder: string,
): unknown {
  if (isInfiniteData(data)) {
    let changed = false;
    const nextPages = data.pages.map((page) => {
      const nextPage = removeDeletedFromList(
        page,
        deleted,
        deletedPrefixes,
        queryFolder,
      );
      if (nextPage !== page) changed = true;
      return nextPage;
    });
    return changed ? { ...data, pages: nextPages } : data;
  }

  return removeDeletedFromList(data, deleted, deletedPrefixes, queryFolder);
}

/**
 * Single Drive write invalidation path: runs only after a successful write.
 * Cancels in-flight reads on the store prefix (including cold keys with no data
 * yet, which `invalidateQueries` alone would reuse), removes `deletedIds` from
 * loaded (`status === "success"`) entries, then invalidates the prefix.
 */
export async function invalidateDrive(
  queryClient: QueryClient,
  store: FileStore,
  options?: InvalidateDriveOptions,
): Promise<void> {
  const prefix = driveQueryKeys.prefix(store);
  await queryClient.cancelQueries({ queryKey: prefix });

  const deleted = new Set<string>();
  for (const raw of options?.deletedIds ?? []) {
    const normalized = normalizeDeletedEntry(raw);
    if (normalized.length > 0) {
      deleted.add(normalized);
    }
  }
  const deletedPrefixes = Array.from(deleted, (entry) => `${entry}/`);

  if (deleted.size > 0) {
    for (const query of queryClient
      .getQueryCache()
      .findAll({ queryKey: prefix })) {
      if (query.state.status !== "success") continue;
      const current = query.state.data;
      if (current === undefined) continue;

      const next = removeDeletedFromData(
        current,
        deleted,
        deletedPrefixes,
        pickerQueryFolder(query.queryKey),
      );
      if (next !== current) {
        queryClient.setQueryData(query.queryKey, next);
      }
    }
  }

  await queryClient.invalidateQueries({ queryKey: prefix });
}
