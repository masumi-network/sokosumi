import { isDriveFolderMarker } from "@sokosumi/utils";
import type { ListBlobResult } from "@vercel/blob";
import { list } from "@vercel/blob";
import type { DriveTaskOutputRecentsRow } from "@/helpers/drive-task-output-catalog";
import { badRequest } from "@/helpers/error";
import type { DriveRecentsItem } from "@/schemas/drive-recents.schema";

const RECENTS_CURSOR_VERSION = 1;

interface RecentsCursorPayload {
  v: typeof RECENTS_CURSOR_VERSION;
  activityAt: string;
  kind: DriveRecentsItem["kind"];
  id: string;
  driveBlobCursor?: string | null;
  taskFileCursor?: string | null;
}

export interface DriveRecentsPageState {
  lastItem: DriveRecentsItem | null;
  driveBlobCursor: string | null;
  taskFileCursor: string | null;
}

export interface DriveRecentsPageResult {
  items: DriveRecentsItem[];
  nextCursor: string | null;
  driveBlobCursor: string | null;
  taskFileCursor: string | null;
  hasMore: boolean;
}

function recentsItemId(item: DriveRecentsItem): string {
  if (item.kind === "drive-file") {
    return item.pathname;
  }
  return item.taskFileId;
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

export function encodeDriveRecentsCursor(input: {
  lastItem: DriveRecentsItem;
  driveBlobCursor: string | null;
  taskFileCursor: string | null;
}): string {
  const payload: RecentsCursorPayload = {
    v: RECENTS_CURSOR_VERSION,
    activityAt: input.lastItem.activityAt,
    kind: input.lastItem.kind,
    id: recentsItemId(input.lastItem),
    driveBlobCursor: input.driveBlobCursor,
    taskFileCursor: input.taskFileCursor,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeDriveRecentsCursor(
  cursor: string,
): DriveRecentsPageState {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const payload = JSON.parse(decoded) as RecentsCursorPayload;
    if (payload.v !== RECENTS_CURSOR_VERSION) {
      throw badRequest("Invalid pagination cursor");
    }
    if (!payload.activityAt || !payload.kind || !payload.id) {
      throw badRequest("Invalid pagination cursor");
    }

    const lastItem: DriveRecentsItem =
      payload.kind === "drive-file"
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

    return {
      lastItem,
      driveBlobCursor: payload.driveBlobCursor ?? null,
      taskFileCursor: payload.taskFileCursor ?? null,
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
  fetchTaskOutputs: (options: { cursor?: string; take: number }) => Promise<{
    rows: DriveTaskOutputRecentsRow[];
    hasMore: boolean;
    nextCursor: string | null;
  }>;
}): Promise<DriveRecentsPageResult> {
  const searchQuery = input.searchQuery?.trim() ?? "";
  const pageState = input.cursor
    ? decodeDriveRecentsCursor(input.cursor)
    : {
        lastItem: null,
        driveBlobCursor: null,
        taskFileCursor: null,
      };

  const batchSize = Math.max(input.limit * 4, 20);
  const pool: DriveRecentsItem[] = [];
  const poolItemIds = new Set<string>();
  let driveBlobCursor = pageState.driveBlobCursor;
  let taskFileCursor = pageState.taskFileCursor;
  let driveHasMore = true;
  let taskHasMore = true;

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
    return true;
  }

  function addItemsToPool(items: DriveRecentsItem[]): void {
    for (const item of items) {
      const itemId = recentsItemId(item);
      if (poolItemIds.has(itemId)) {
        continue;
      }
      poolItemIds.add(itemId);
      pool.push(item);
    }
  }

  function getTopEligiblePreview(): {
    signature: string | null;
    count: number;
  } {
    const topEligible: DriveRecentsItem[] = [];
    for (const item of pool) {
      if (!shouldIncludeItem(item)) {
        continue;
      }
      topEligible.push(item);
      if (topEligible.length >= input.limit + 1) {
        break;
      }
    }

    if (topEligible.length === 0) {
      return { signature: null, count: 0 };
    }

    return {
      signature: topEligible.map(recentsItemId).join("\0"),
      count: topEligible.length,
    };
  }

  let previousTopSignature: string | null = null;

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

    driveHasMore = driveBatch.hasMore;
    taskHasMore = taskBatch.hasMore;
    driveBlobCursor = driveBatch.nextCursor;
    taskFileCursor = taskBatch.nextCursor;

    addItemsToPool(driveBatch.items);
    addItemsToPool(taskBatch.rows.map(mapTaskOutputRowToRecentsItem));

    pool.sort(compareDriveRecentsItems);
    const { signature: topSignature, count: topEligibleCount } =
      getTopEligiblePreview();

    if (!driveHasMore && !taskHasMore) {
      break;
    }

    if (
      topSignature !== null &&
      topSignature === previousTopSignature &&
      topEligibleCount >= input.limit + 1
    ) {
      break;
    }

    previousTopSignature = topSignature;
  }

  pool.sort(compareDriveRecentsItems);

  const merged: DriveRecentsItem[] = [];
  for (const item of pool) {
    if (!shouldIncludeItem(item)) {
      continue;
    }
    merged.push(item);
    if (merged.length >= input.limit + 1) {
      break;
    }
  }

  const hasMore = merged.length > input.limit;
  const items = merged.slice(0, input.limit);
  const lastItem = items[items.length - 1] ?? null;

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && lastItem
        ? encodeDriveRecentsCursor({
            lastItem,
            driveBlobCursor,
            taskFileCursor,
          })
        : null,
    driveBlobCursor,
    taskFileCursor,
  };
}
