import { createHmac, timingSafeEqual } from "node:crypto";
import { isDriveFolderMarker } from "@sokosumi/utils";
import type { ListBlobResult } from "@vercel/blob";
import { list } from "@vercel/blob";
import {
  driveFileTypeFamily,
  driveFileTypeFamilyRank,
} from "@/helpers/drive-file-type-family";
import type { DriveTaskOutputRecentsRow } from "@/helpers/drive-task-output-catalog";
import { badRequest } from "@/helpers/error";
import type { DriveListSort } from "@/schemas/drive-list-sort.schema";
import type { DriveRecentsItem } from "@/schemas/drive-recents.schema";

const RECENTS_CURSOR_VERSION = 3;

interface RecentsCursorPayload {
  v: typeof RECENTS_CURSOR_VERSION;
  activityAt: string;
  kind: DriveRecentsItem["kind"];
  id: string;
}

export interface DriveRecentsCursorBinding {
  prefix: string;
  searchQuery: string;
  /** Fingerprint of sort so cursors cannot continue under a different order. */
  sortFingerprint: string;
}

export interface DriveRecentsSortOptions {
  /** Primary activityAt direction. Default desc. */
  activityOrder: "asc" | "desc";
  /** Secondary key when UI asks for name/type. Null keeps kind+id ties. */
  secondary: "name" | "type" | null;
  secondaryOrder: "asc" | "desc";
}

export const DEFAULT_DRIVE_RECENTS_SORT: DriveRecentsSortOptions = {
  activityOrder: "desc",
  secondary: null,
  secondaryOrder: "asc",
};

export function driveRecentsSortFingerprint(
  options: DriveRecentsSortOptions,
): string {
  return [
    options.activityOrder,
    options.secondary ?? "none",
    options.secondaryOrder,
  ].join(":");
}

/**
 * Map shared Files sort vocabulary onto Recents rules:
 * activityAt always primary; name/type are secondary only.
 */
export function resolveDriveRecentsSort(
  sort: DriveListSort | null,
): DriveRecentsSortOptions {
  if (!sort) {
    return DEFAULT_DRIVE_RECENTS_SORT;
  }

  if (sort.sortBy === "date") {
    return {
      activityOrder: sort.sortOrder,
      secondary: null,
      secondaryOrder: "asc",
    };
  }

  return {
    activityOrder: "desc",
    secondary: sort.sortBy,
    secondaryOrder: sort.sortOrder,
  };
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
  options: DriveRecentsSortOptions = DEFAULT_DRIVE_RECENTS_SORT,
): number {
  const leftTime = Date.parse(left.activityAt);
  const rightTime = Date.parse(right.activityAt);
  if (leftTime !== rightTime) {
    return options.activityOrder === "desc"
      ? rightTime - leftTime
      : leftTime - rightTime;
  }

  if (options.secondary === "name") {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return options.secondaryOrder === "asc" ? byName : -byName;
    }
  } else if (options.secondary === "type") {
    const leftRank = driveFileTypeFamilyRank(driveFileTypeFamily(left.name));
    const rightRank = driveFileTypeFamilyRank(driveFileTypeFamily(right.name));
    if (leftRank !== rightRank) {
      return options.secondaryOrder === "asc"
        ? leftRank - rightRank
        : rightRank - leftRank;
    }
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }
  }

  if (left.kind !== right.kind) {
    return left.kind.localeCompare(right.kind);
  }

  return recentsItemId(right).localeCompare(recentsItemId(left));
}

export function isRecentsItemOlderThanCursor(
  item: DriveRecentsItem,
  cursorItem: DriveRecentsItem,
  options: DriveRecentsSortOptions = DEFAULT_DRIVE_RECENTS_SORT,
): boolean {
  return compareDriveRecentsItems(item, cursorItem, options) > 0;
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
  return payload.kind === "drive-file"
    ? {
        kind: "drive-file",
        name: "",
        fileUrl: "https://example.com/placeholder",
        pathname: payload.id,
        size: 0,
        activityAt: payload.activityAt,
      }
    : {
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

async function fetchDriveBlobRecentsBatch(input: {
  prefix: string;
  token: string;
  cursor?: string | null;
  take: number;
}): Promise<{
  items: DriveRecentsItem[];
  hasMore: boolean;
  nextCursor: string | null;
}> {
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

export async function fetchDriveRecentsPage(input: {
  prefix: string;
  token: string;
  limit: number;
  cursor?: string;
  searchQuery?: string;
  cursorSecret: string;
  cursorBinding: DriveRecentsCursorBinding;
  sort?: DriveRecentsSortOptions;
  fetchTaskOutputs: (options: { cursor?: string; take: number }) => Promise<{
    rows: DriveTaskOutputRecentsRow[];
    hasMore: boolean;
    nextCursor: string | null;
  }>;
}): Promise<DriveRecentsPageResult> {
  const searchQuery = input.searchQuery?.trim() ?? "";
  const sort = input.sort ?? DEFAULT_DRIVE_RECENTS_SORT;
  const cursorBinding: DriveRecentsCursorBinding = {
    prefix: input.cursorBinding.prefix,
    searchQuery,
    sortFingerprint: driveRecentsSortFingerprint(sort),
  };

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
  let driveBlobCursor: string | null = null;
  let taskFileCursor: string | null = null;
  let driveHasMore = true;
  let taskHasMore = true;

  function shouldIncludeItem(item: DriveRecentsItem): boolean {
    if (
      pageState.lastItem &&
      !isRecentsItemOlderThanCursor(item, pageState.lastItem, sort)
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
    return true;
  }

  function trimPoolToNewest(): void {
    if (pool.length <= poolCap) {
      return;
    }
    pool.sort((a, b) => compareDriveRecentsItems(a, b, sort));
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
        pool.sort((a, b) => compareDriveRecentsItems(a, b, sort));
        const oldestKept = pool[pool.length - 1];
        if (
          oldestKept &&
          compareDriveRecentsItems(item, oldestKept, sort) >= 0
        ) {
          continue;
        }
      }

      poolItemIds.add(itemId);
      pool.push(item);
    }
    trimPoolToNewest();
  }

  while (driveHasMore || taskHasMore) {
    type DriveBlobRecentsBatch = Awaited<
      ReturnType<typeof fetchDriveBlobRecentsBatch>
    >;
    type TaskOutputRecentsBatch = Awaited<
      ReturnType<typeof input.fetchTaskOutputs>
    >;

    const [driveBatch, taskBatch]: [
      DriveBlobRecentsBatch,
      TaskOutputRecentsBatch,
    ] = await Promise.all([
      driveHasMore
        ? fetchDriveBlobRecentsBatch({
            prefix: input.prefix,
            token: input.token,
            cursor: driveBlobCursor,
            take: batchSize,
          })
        : Promise.resolve({
            items: [] as DriveRecentsItem[],
            hasMore: false,
            nextCursor: null,
          }),
      taskHasMore
        ? input.fetchTaskOutputs({
            cursor: taskFileCursor ?? undefined,
            take: batchSize,
          })
        : Promise.resolve({
            rows: [] as DriveTaskOutputRecentsRow[],
            hasMore: false,
            nextCursor: null,
          }),
    ]);

    addItemsToPool(driveBatch.items);
    addItemsToPool(taskBatch.rows.map(mapTaskOutputRowToRecentsItem));

    driveHasMore = driveBatch.hasMore;
    driveBlobCursor = driveBatch.nextCursor;
    taskHasMore = taskBatch.hasMore;
    taskFileCursor = taskBatch.nextCursor;
  }

  pool.sort((a, b) => compareDriveRecentsItems(a, b, sort));

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
