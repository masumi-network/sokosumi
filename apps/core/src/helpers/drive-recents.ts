import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "@hono/zod-openapi";
import { isDriveFolderMarker } from "@sokosumi/utils";
import type { ListBlobResult } from "@vercel/blob";
import { head, list } from "@vercel/blob";
import type { DriveTaskOutputRecentsRow } from "@/helpers/drive-task-output-catalog";
import { badRequest } from "@/helpers/error";
import type { DriveRecentsItem } from "@/schemas/drive-recents.schema";
import { driveRecentsItemSchema } from "@/schemas/drive-recents.schema";

const RECENTS_CURSOR_VERSION = 2;
const MAX_PENDING_REFS = 100;

const driveRecentsItemRefSchema = z.object({
  kind: z.enum(["drive-file", "task-output"]),
  id: z.string().min(1),
  activityAt: z.string().min(1),
});

type DriveRecentsItemRef = z.infer<typeof driveRecentsItemRefSchema>;

interface RecentsCursorPayload {
  v: typeof RECENTS_CURSOR_VERSION;
  activityAt: string;
  kind: DriveRecentsItem["kind"];
  id: string;
  driveBlobCursor?: string | null;
  taskFileCursor?: string | null;
  pendingRefs?: DriveRecentsItemRef[];
}

export interface DriveRecentsCursorBinding {
  prefix: string;
  searchQuery: string;
}

export interface DriveRecentsPageState {
  lastItem: DriveRecentsItem | null;
  driveBlobCursor: string | null;
  taskFileCursor: string | null;
  pendingRefs: DriveRecentsItemRef[];
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

function recentsItemRef(item: DriveRecentsItem): DriveRecentsItemRef {
  return {
    kind: item.kind,
    id: recentsItemId(item),
    activityAt: normalizeRecentsActivityAt(item.activityAt),
  };
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
  };

  if (payload.v !== RECENTS_CURSOR_VERSION) {
    throw badRequest("Invalid pagination cursor");
  }
  if (!payload.activityAt || !payload.kind || !payload.id) {
    throw badRequest("Invalid pagination cursor");
  }
  if ("pendingItems" in payload) {
    throw badRequest("Invalid pagination cursor");
  }

  let pendingRefs: DriveRecentsItemRef[] | undefined;
  if (payload.pendingRefs !== undefined) {
    const parsed = z
      .array(driveRecentsItemRefSchema)
      .safeParse(payload.pendingRefs);
    if (!parsed.success) {
      throw badRequest("Invalid pagination cursor");
    }
    pendingRefs = parsed.data;
  }

  return {
    v: RECENTS_CURSOR_VERSION,
    activityAt: payload.activityAt,
    kind: payload.kind,
    id: payload.id,
    driveBlobCursor: payload.driveBlobCursor ?? null,
    taskFileCursor: payload.taskFileCursor ?? null,
    ...(pendingRefs && pendingRefs.length > 0 ? { pendingRefs } : {}),
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
  driveBlobCursor: string | null;
  taskFileCursor: string | null;
  pendingRefs?: DriveRecentsItemRef[];
  cursorSecret: string;
  cursorBinding: DriveRecentsCursorBinding;
}): string {
  const payload: RecentsCursorPayload = {
    v: RECENTS_CURSOR_VERSION,
    activityAt: normalizeRecentsActivityAt(input.lastItem.activityAt),
    kind: input.lastItem.kind,
    id: recentsItemId(input.lastItem),
    driveBlobCursor: input.driveBlobCursor,
    taskFileCursor: input.taskFileCursor,
    ...(input.pendingRefs && input.pendingRefs.length > 0
      ? { pendingRefs: input.pendingRefs }
      : {}),
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

export async function hydrateDriveRecentsPendingRefs(input: {
  refs: DriveRecentsItemRef[];
  prefix: string;
  token: string;
  fetchTaskOutputsByIds: (
    ids: string[],
  ) => Promise<DriveTaskOutputRecentsRow[]>;
}): Promise<DriveRecentsItem[]> {
  const hydrated: DriveRecentsItem[] = [];

  const taskOutputIds = input.refs
    .filter((ref) => ref.kind === "task-output")
    .map((ref) => ref.id);
  const taskRows =
    taskOutputIds.length > 0
      ? await input.fetchTaskOutputsByIds(taskOutputIds)
      : [];
  const taskRowById = new Map(taskRows.map((row) => [row.id, row]));

  for (const ref of input.refs) {
    if (ref.kind === "drive-file") {
      if (!ref.id.startsWith(input.prefix)) {
        continue;
      }

      try {
        const blob = await head(ref.id, { token: input.token });
        if (isDriveFolderMarker(blob.pathname)) {
          continue;
        }
        if (!blob.uploadedAt) {
          continue;
        }
        const segments = blob.pathname
          .split("/")
          .filter((segment) => segment.length > 0);
        const name = segments[segments.length - 1];
        if (!name) {
          continue;
        }
        const activityAt = ref.activityAt;
        const item: DriveRecentsItem = {
          kind: "drive-file",
          name,
          fileUrl: blob.url,
          pathname: blob.pathname,
          size:
            typeof blob.size === "number" && Number.isFinite(blob.size)
              ? blob.size
              : 0,
          activityAt,
        };
        hydrated.push(item);
      } catch {
        continue;
      }
      continue;
    }

    const row = taskRowById.get(ref.id);
    if (!row) {
      continue;
    }
    const item = mapTaskOutputRowToRecentsItem(row);
    if (normalizeRecentsActivityAt(item.activityAt) === ref.activityAt) {
      hydrated.push(item);
    }
  }

  return hydrated;
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
      driveBlobCursor: payload.driveBlobCursor ?? null,
      taskFileCursor: payload.taskFileCursor ?? null,
      pendingRefs: payload.pendingRefs ?? [],
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
  fetchTaskOutputs: (options: { cursor?: string; take: number }) => Promise<{
    rows: DriveTaskOutputRecentsRow[];
    hasMore: boolean;
    nextCursor: string | null;
  }>;
  fetchTaskOutputsByIds: (
    ids: string[],
  ) => Promise<DriveTaskOutputRecentsRow[]>;
}): Promise<DriveRecentsPageResult> {
  const searchQuery = input.searchQuery?.trim() ?? "";
  const cursorBinding: DriveRecentsCursorBinding = {
    prefix: input.cursorBinding.prefix,
    searchQuery,
  };

  let pageState: DriveRecentsPageState = {
    lastItem: null,
    driveBlobCursor: null,
    taskFileCursor: null,
    pendingRefs: [],
  };

  if (input.cursor) {
    pageState = decodeDriveRecentsCursor(input.cursor, {
      cursorSecret: input.cursorSecret,
      cursorBinding,
    });
  }

  const hydratedPending =
    pageState.pendingRefs.length > 0
      ? await hydrateDriveRecentsPendingRefs({
          refs: pageState.pendingRefs,
          prefix: input.prefix,
          token: input.token,
          fetchTaskOutputsByIds: input.fetchTaskOutputsByIds,
        })
      : [];

  const validatedPending: DriveRecentsItem[] = [];
  for (const item of hydratedPending) {
    const parsed = driveRecentsItemSchema.safeParse(item);
    if (parsed.success) {
      validatedPending.push(parsed.data);
    }
  }

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

  function countEligibleItems(): number {
    return pool.filter((item) => shouldIncludeItem(item)).length;
  }

  function hasReachedPendingRefCap(): boolean {
    return countEligibleItems() >= input.limit + MAX_PENDING_REFS;
  }

  function addItemsToPool(items: DriveRecentsItem[]): boolean {
    const sortedItems = [...items].sort(compareDriveRecentsItems);

    for (const item of sortedItems) {
      if (hasReachedPendingRefCap()) {
        return false;
      }

      const itemId = recentsItemId(item);
      if (poolItemIds.has(itemId)) {
        continue;
      }
      poolItemIds.add(itemId);
      pool.push(item);
    }

    return true;
  }

  addItemsToPool(validatedPending);

  function collectPendingRefs(
    returnedItems: DriveRecentsItem[],
  ): DriveRecentsItemRef[] {
    const returnedIds = new Set(returnedItems.map(recentsItemId));
    const pendingItems: DriveRecentsItem[] = [];
    for (const item of pool) {
      if (!shouldIncludeItem(item)) {
        continue;
      }
      if (returnedIds.has(recentsItemId(item))) {
        continue;
      }
      pendingItems.push(item);
    }
    pendingItems.sort(compareDriveRecentsItems);
    return pendingItems.map(recentsItemRef);
  }

  while (driveHasMore || taskHasMore) {
    pool.sort(compareDriveRecentsItems);

    const eligibleCount = countEligibleItems();
    if (!driveHasMore && !taskHasMore) {
      break;
    }
    if (eligibleCount >= input.limit + MAX_PENDING_REFS) {
      break;
    }
    if (!driveHasMore && eligibleCount >= input.limit + 1) {
      break;
    }

    type DriveBlobRecentsBatch = Awaited<
      ReturnType<typeof fetchDriveBlobRecentsBatch>
    >;
    type TaskOutputRecentsBatch = Awaited<
      ReturnType<typeof input.fetchTaskOutputs>
    >;

    const driveCursorBeforeBatch = driveBlobCursor;
    const taskCursorBeforeBatch = taskFileCursor;

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

    const driveItemsFullyConsumed = addItemsToPool(driveBatch.items);
    if (driveItemsFullyConsumed) {
      driveHasMore = driveBatch.hasMore;
      driveBlobCursor = driveBatch.nextCursor;
    } else {
      driveHasMore = true;
      driveBlobCursor = driveCursorBeforeBatch;
    }

    const taskItemsFullyConsumed = addItemsToPool(
      taskBatch.rows.map(mapTaskOutputRowToRecentsItem),
    );
    if (taskItemsFullyConsumed) {
      taskHasMore = taskBatch.hasMore;
      taskFileCursor = taskBatch.nextCursor;
    } else {
      taskHasMore = true;
      taskFileCursor = taskCursorBeforeBatch;
    }

    if (!driveItemsFullyConsumed || !taskItemsFullyConsumed) {
      break;
    }
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
  const pendingRefs = hasMore ? collectPendingRefs(items) : [];

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && lastItem
        ? encodeDriveRecentsCursor({
            lastItem,
            driveBlobCursor,
            taskFileCursor,
            pendingRefs,
            cursorSecret: input.cursorSecret,
            cursorBinding,
          })
        : null,
    driveBlobCursor,
    taskFileCursor,
  };
}
