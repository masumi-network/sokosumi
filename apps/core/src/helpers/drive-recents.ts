import { createHmac, timingSafeEqual } from "node:crypto";
import { isDriveFolderMarker } from "@sokosumi/utils";
import type { ListBlobResult } from "@vercel/blob";
import { list } from "@vercel/blob";
import type { DriveTaskOutputRecentsRow } from "@/helpers/drive-task-output-catalog";
import { badRequest } from "@/helpers/error";
import type { DriveRecentsItem } from "@/schemas/drive-recents.schema";

const RECENTS_CURSOR_VERSION = 4;

interface RecentsCursorPayload {
  v: typeof RECENTS_CURSOR_VERSION;
  activityAt: string;
  kind: DriveRecentsItem["kind"];
  id: string;
}

export interface DriveRecentsCursorBinding {
  prefix: string;
  searchQuery: string;
  /** Sorted, comma-joined label ids. Absent when no tag filter applies. */
  labelIds?: string;
}

export interface DriveRecentsPageState {
  lastItem: DriveRecentsItem | null;
}

export interface DriveRecentsPageResult {
  items: DriveRecentsItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

function recentsItemId(item: DriveRecentsItem): string {
  if (item.kind === "drive-file") {
    return item.pathname;
  }
  if (item.kind === "table") {
    return item.tableId;
  }
  return item.taskFileId;
}

function normalizeRecentsActivityAt(activityAt: string | Date): string {
  return typeof activityAt === "string" ? activityAt : activityAt.toISOString();
}

export function driveRecentsDriveFileNameMatchesSearch(
  name: string,
  searchQuery: string,
): boolean {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return name.toLowerCase().includes(normalizedQuery);
}

export function compareDriveRecentsItems(
  left: DriveRecentsItem,
  right: DriveRecentsItem,
): number {
  const timeDiff = Date.parse(right.activityAt) - Date.parse(left.activityAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  if (left.kind !== right.kind) {
    return left.kind.localeCompare(right.kind);
  }

  return recentsItemId(right).localeCompare(recentsItemId(left));
}

export function isRecentsItemOlderThanCursor(
  item: DriveRecentsItem,
  cursorItem: DriveRecentsItem,
): boolean {
  return compareDriveRecentsItems(item, cursorItem) > 0;
}

function signRecentsCursorEnvelope(
  payload: RecentsCursorPayload,
  secret: string,
  binding: DriveRecentsCursorBinding,
): string {
  const payloadJson = JSON.stringify(payload);
  const bindingJson = JSON.stringify(binding);
  const signature = createHmac("sha256", secret)
    .update(bindingJson)
    .update("\0")
    .update(payloadJson)
    .digest("base64url");

  return Buffer.from(
    JSON.stringify({ payload: payloadJson, signature }),
    "utf8",
  ).toString("base64url");
}

function parseRecentsCursorPayload(raw: unknown): RecentsCursorPayload {
  if (!raw || typeof raw !== "object") {
    throw badRequest("Invalid pagination cursor");
  }

  const payload = raw as Partial<RecentsCursorPayload> & {
    pendingItems?: unknown;
    pendingRefs?: unknown;
    driveBlobCursor?: unknown;
    taskFileCursor?: unknown;
  };

  if (payload.v !== RECENTS_CURSOR_VERSION) {
    throw badRequest("Invalid pagination cursor");
  }
  if (!payload.activityAt || !payload.kind || !payload.id) {
    throw badRequest("Invalid pagination cursor");
  }
  if (
    "pendingItems" in payload ||
    "pendingRefs" in payload ||
    "driveBlobCursor" in payload ||
    "taskFileCursor" in payload
  ) {
    throw badRequest("Invalid pagination cursor");
  }

  return {
    v: RECENTS_CURSOR_VERSION,
    activityAt: payload.activityAt,
    kind: payload.kind,
    id: payload.id,
  };
}

function verifyRecentsCursorSignature(
  payloadJson: string,
  signature: string,
  secret: string,
  binding: DriveRecentsCursorBinding,
): void {
  const bindingJson = JSON.stringify(binding);
  const expected = createHmac("sha256", secret)
    .update(bindingJson)
    .update("\0")
    .update(payloadJson)
    .digest("base64url");

  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    signatureBuf.length !== expectedBuf.length ||
    !timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    throw badRequest("Invalid pagination cursor");
  }
}

export function encodeDriveRecentsCursor(input: {
  lastItem: DriveRecentsItem;
  cursorSecret: string;
  cursorBinding: DriveRecentsCursorBinding;
}): string {
  const payload: RecentsCursorPayload = {
    v: RECENTS_CURSOR_VERSION,
    activityAt: normalizeRecentsActivityAt(input.lastItem.activityAt),
    kind: input.lastItem.kind,
    id: recentsItemId(input.lastItem),
  };

  return signRecentsCursorEnvelope(
    payload,
    input.cursorSecret,
    input.cursorBinding,
  );
}

function lastItemFromCursorPayload(
  payload: RecentsCursorPayload,
): DriveRecentsItem {
  if (payload.kind === "drive-file")
    return {
      kind: "drive-file",
      name: "",
      fileUrl: "https://example.com/placeholder",
      pathname: payload.id,
      size: 0,
      activityAt: payload.activityAt,
      resourceId: null,
      category: null,
      tags: [],
    };
  if (payload.kind === "table")
    return {
      kind: "table",
      tableId: payload.id,
      name: "",
      activityAt: payload.activityAt,
      projectId: null,
    };
  return {
    kind: "task-output",
    name: "",
    fileUrl: "https://example.com/placeholder",
    size: null,
    activityAt: payload.activityAt,
    taskFileId: payload.id,
    taskId: "",
    taskName: "",
    projectId: null,
    projectName: null,
  };
}

export function decodeDriveRecentsCursor(
  cursor: string,
  input: {
    cursorSecret: string;
    cursorBinding: DriveRecentsCursorBinding;
  },
): DriveRecentsPageState {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const envelope = JSON.parse(decoded) as {
      payload?: string;
      signature?: string;
    };

    if (!envelope.payload || !envelope.signature) {
      throw badRequest("Invalid pagination cursor");
    }

    verifyRecentsCursorSignature(
      envelope.payload,
      envelope.signature,
      input.cursorSecret,
      input.cursorBinding,
    );

    const payload = parseRecentsCursorPayload(JSON.parse(envelope.payload));

    return {
      lastItem: lastItemFromCursorPayload(payload),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Invalid pagination cursor"
    ) {
      throw error;
    }
    throw badRequest("Invalid pagination cursor");
  }
}

function mapDriveBlobToRecentsItem(
  blob: ListBlobResult["blobs"][number],
): DriveRecentsItem | null {
  if (isDriveFolderMarker(blob.pathname)) {
    return null;
  }

  const segments = blob.pathname
    .split("/")
    .filter((segment) => segment.length > 0);
  const name = segments[segments.length - 1];
  if (!name) {
    return null;
  }

  return {
    kind: "drive-file",
    name,
    fileUrl: blob.url,
    pathname: blob.pathname,
    size: blob.size,
    activityAt: blob.uploadedAt.toISOString(),
    resourceId: null,
    category: null,
    tags: [],
  };
}

function mapTaskOutputRowToRecentsItem(
  row: DriveTaskOutputRecentsRow,
): DriveRecentsItem {
  return {
    kind: "task-output",
    name: row.name,
    fileUrl: row.fileUrl,
    size: row.size,
    activityAt: row.updatedAt.toISOString(),
    taskFileId: row.id,
    taskId: row.taskId,
    taskName: row.taskName,
    projectId: row.projectId,
    projectName: row.projectName,
  };
}

export interface DriveRecentsBatch {
  items: DriveRecentsItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

type DriveRecentsSource = (options: {
  cursor?: string;
  take: number;
}) => Promise<DriveRecentsBatch>;

async function fetchDriveBlobRecentsBatch(input: {
  prefix: string;
  token: string;
  cursor?: string | null;
  take: number;
}): Promise<DriveRecentsBatch> {
  const page = await list({
    prefix: input.prefix,
    token: input.token,
    cursor: input.cursor ?? undefined,
    limit: input.take,
  });

  const items: DriveRecentsItem[] = [];
  for (const blob of page.blobs) {
    const item = mapDriveBlobToRecentsItem(blob);
    if (item) {
      items.push(item);
    }
  }

  return {
    items,
    hasMore: page.hasMore,
    nextCursor: page.hasMore ? (page.cursor ?? null) : null,
  };
}

/**
 * Merge every source (pathname-ordered blob pages, newest-first task outputs
 * and, when given, newest-first tables) into a newest-first pool of size
 * `limit + 1`. The signed cursor stores only the page boundary.
 */
export async function fetchDriveRecentsPage(input: {
  prefix: string;
  token: string;
  limit: number;
  cursor?: string;
  searchQuery?: string;
  /**
   * Only Drive files at these pathnames, and nothing from the other sources:
   * the tag filter, which only Drive files can match.
   */
  driveFilePathnames?: ReadonlySet<string>;
  cursorSecret: string;
  cursorBinding: DriveRecentsCursorBinding;
  /** Newest first (`updatedAt` desc), the order their `activityAt` sorts in. */
  fetchTaskOutputs: (options: { cursor?: string; take: number }) => Promise<{
    rows: DriveTaskOutputRecentsRow[];
    hasMore: boolean;
    nextCursor: string | null;
  }>;
  /** Newest first and already filtered by the search query. */
  fetchTables?: DriveRecentsSource;
}): Promise<DriveRecentsPageResult> {
  const searchQuery = input.searchQuery?.trim() ?? "";
  const cursorBinding: DriveRecentsCursorBinding = {
    prefix: input.cursorBinding.prefix,
    searchQuery,
    ...(input.cursorBinding.labelIds
      ? { labelIds: input.cursorBinding.labelIds }
      : {}),
  };
  const driveFilePathnames = input.driveFilePathnames;

  let pageState: DriveRecentsPageState = {
    lastItem: null,
  };

  if (input.cursor) {
    pageState = decodeDriveRecentsCursor(input.cursor, {
      cursorSecret: input.cursorSecret,
      cursorBinding,
    });
  }

  const batchSize = Math.max(input.limit * 4, 20);
  const poolCap = input.limit + 1;
  const pool: DriveRecentsItem[] = [];
  const poolItemIds = new Set<string>();

  function shouldIncludeItem(item: DriveRecentsItem): boolean {
    if (
      pageState.lastItem &&
      !isRecentsItemOlderThanCursor(item, pageState.lastItem)
    ) {
      return false;
    }
    if (
      searchQuery &&
      item.kind === "drive-file" &&
      !driveRecentsDriveFileNameMatchesSearch(item.name, searchQuery)
    ) {
      return false;
    }
    if (
      driveFilePathnames &&
      (item.kind !== "drive-file" || !driveFilePathnames.has(item.pathname))
    ) {
      return false;
    }
    return true;
  }

  function trimPoolToNewest(): void {
    if (pool.length <= poolCap) {
      return;
    }
    pool.sort(compareDriveRecentsItems);
    const removed = pool.splice(poolCap);
    for (const item of removed) {
      poolItemIds.delete(recentsItemId(item));
    }
  }

  function addItemsToPool(items: DriveRecentsItem[]): void {
    for (const item of items) {
      if (!shouldIncludeItem(item)) {
        continue;
      }

      const itemId = recentsItemId(item);
      if (poolItemIds.has(itemId)) {
        continue;
      }

      if (pool.length >= poolCap) {
        pool.sort(compareDriveRecentsItems);
        const oldestKept = pool[pool.length - 1];
        if (oldestKept && compareDriveRecentsItems(item, oldestKept) >= 0) {
          continue;
        }
      }

      poolItemIds.add(itemId);
      pool.push(item);
    }
    trimPoolToNewest();
  }

  // Nothing carries the label, so there is no store to walk.
  if (driveFilePathnames?.size === 0) {
    return { items: [], hasMore: false, nextCursor: null };
  }

  // Blob pages come in pathname order, so that source is read to the end.
  // Task outputs and tables come newest first and stop once they can only
  // add items older than a full pool: a workspace with thousands of task
  // files no longer reads every one of them on each visit.
  const sources: Array<{
    fetch: DriveRecentsSource;
    cursor?: string;
    hasMore: boolean;
    newestFirst?: boolean;
  }> = [
    {
      fetch: ({ cursor, take }) =>
        fetchDriveBlobRecentsBatch({
          prefix: input.prefix,
          token: input.token,
          cursor,
          take,
        }),
      hasMore: true,
    },
  ];
  if (!driveFilePathnames) {
    sources.push({
      fetch: async (options) => {
        const batch = await input.fetchTaskOutputs(options);
        return {
          items: batch.rows.map(mapTaskOutputRowToRecentsItem),
          hasMore: batch.hasMore,
          nextCursor: batch.nextCursor,
        };
      },
      hasMore: true,
      newestFirst: true,
    });
  }
  if (input.fetchTables && !driveFilePathnames)
    sources.push({
      fetch: input.fetchTables,
      hasMore: true,
      newestFirst: true,
    });

  /** A newest-first batch that ends older than a full pool has nothing left to add. */
  function exhaustsPool(items: DriveRecentsItem[]): boolean {
    const oldestKept = pool[pool.length - 1];
    const last = items[items.length - 1];
    return (
      pool.length >= poolCap &&
      !!oldestKept &&
      !!last &&
      Date.parse(last.activityAt) < Date.parse(oldestKept.activityAt)
    );
  }

  while (sources.some((source) => source.hasMore)) {
    const batches = await Promise.all(
      sources.map((source) =>
        source.hasMore
          ? source.fetch({ cursor: source.cursor, take: batchSize })
          : null,
      ),
    );
    batches.forEach((batch, index) => {
      if (!batch) return;
      addItemsToPool(batch.items);
      pool.sort(compareDriveRecentsItems);
      sources[index].hasMore =
        batch.hasMore &&
        !(sources[index].newestFirst && exhaustsPool(batch.items));
      sources[index].cursor = batch.nextCursor ?? undefined;
    });
  }

  pool.sort(compareDriveRecentsItems);

  const hasMore = pool.length > input.limit;
  const items = pool.slice(0, input.limit);
  const lastItem = items[items.length - 1] ?? null;

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && lastItem
        ? encodeDriveRecentsCursor({
            lastItem,
            cursorSecret: input.cursorSecret,
            cursorBinding,
          })
        : null,
  };
}
