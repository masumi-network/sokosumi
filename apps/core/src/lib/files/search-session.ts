import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { FileResultWindowKind, type Prisma } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { fileActorFingerprint } from "@/lib/files/actor";
import type {
  FileSearchFilters,
  FileSortBy,
  FileSortOrder,
} from "@/lib/files/retrieval";
import { RESULT_WINDOW_LIMIT } from "@/lib/files/retrieval";

/**
 * A ranked window is a fixed order, taken once and paged by position.
 *
 * Two things follow from that, and both are deliberate. A page advances over
 * every position it scans, so an entry whose revision changed is omitted
 * rather than replaced — a later page can therefore be short. And `hasMore`
 * means "there are unconsumed positions in this snapshot", never "there are
 * more matching documents in the corpus".
 */

export const SEARCH_SESSION_TTL_MS = 5 * 60 * 1000;
export const SELECTION_TOKEN_TTL_MS = 5 * 60 * 1000;
export const SEARCH_PAGE_MAX = 20;
export const BULK_SYNCHRONOUS_MAX = 100;

const CURSOR_VERSION = 1;

export interface WindowEntry {
  /** resourceId */
  r: string;
  /** contentRevision */
  c: number;
  /** metadataRevision */
  m: number;
  /**
   * The chunk that matched, when full-text retrieval found one.
   *
   * Stored with the window because the snippet has to survive paging: a
   * cursor page rebuilds nothing, so without this the passage that
   * matched is lost and the reader gets the document's opening instead.
   * Optional because the browse, metadata and exact-name legs match a
   * document rather than a passage, and because windows written before
   * this field existed do not have it.
   *
   * `FileResultWindow.entries` is Json, so this needs no migration.
   */
  k?: string | null;
}

export interface CursorPayload {
  v: typeof CURSOR_VERSION;
  w: string;
  /** Next unconsumed snapshot position, never a count of returned items. */
  p: number;
}

export function buildSearchBindingDigest(input: {
  query: string | null;
  filters: FileSearchFilters;
  sortBy: FileSortBy;
  sortOrder: FileSortOrder;
  indexGeneration: number;
}): string {
  return createHash("sha256")
    .update(input.query ?? "")
    .update("\0")
    .update(JSON.stringify(input.filters, Object.keys(input.filters).sort()))
    .update("\0")
    .update(input.sortBy)
    .update("\0")
    .update(input.sortOrder)
    .update("\0")
    .update(String(input.indexGeneration))
    .digest("base64url");
}

export function encodeSearchCursor(
  payload: CursorPayload,
  secret: string,
): string {
  const payloadJson = JSON.stringify(payload);
  const signature = createHmac("sha256", secret)
    .update(payloadJson)
    .digest("base64url");
  return Buffer.from(
    JSON.stringify({ payload: payloadJson, signature }),
    "utf8",
  ).toString("base64url");
}

export function decodeSearchCursor(
  cursor: string,
  secret: string,
): CursorPayload {
  let parsed: { payload?: unknown; signature?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw badRequest("Invalid search cursor");
  }

  if (
    typeof parsed.payload !== "string" ||
    typeof parsed.signature !== "string"
  ) {
    throw badRequest("Invalid search cursor");
  }

  const expected = createHmac("sha256", secret)
    .update(parsed.payload)
    .digest("base64url");
  const given = Buffer.from(parsed.signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    throw badRequest("Invalid search cursor");
  }

  const payload = JSON.parse(parsed.payload) as CursorPayload;
  if (payload.v !== CURSOR_VERSION || typeof payload.w !== "string") {
    throw badRequest("Invalid search cursor");
  }
  if (!Number.isInteger(payload.p) || payload.p < 0) {
    throw badRequest("Invalid search cursor");
  }
  return payload;
}

export type WindowRankingMode = "deterministic" | "model";

export async function createResultWindow(input: {
  workspaceId: string;
  actor: FileActor;
  kind: FileResultWindowKind;
  bindingDigest: string;
  epochVector: string;
  entries: WindowEntry[];
  truncated: boolean;
  /**
   * How this order was produced. Stored with the order because a cursor
   * page serves positions out of it and ranks nothing, so it cannot work
   * the answer out for itself.
   *
   * Defaulted for callers that never rank — a selection window is a set of
   * ids, not a ranked order.
   */
  rankingMode?: WindowRankingMode;
  now?: Date;
}): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  const ttl =
    input.kind === FileResultWindowKind.SEARCH
      ? SEARCH_SESSION_TTL_MS
      : SELECTION_TOKEN_TTL_MS;

  return prisma.fileResultWindow.create({
    data: {
      workspaceId: input.workspaceId,
      kind: input.kind,
      actorFingerprint: fileActorFingerprint(input.actor, input.workspaceId),
      bindingDigest: input.bindingDigest,
      epochVector: input.epochVector,
      entries: input.entries.slice(
        0,
        RESULT_WINDOW_LIMIT,
      ) as unknown as Prisma.InputJsonValue,
      truncated: input.truncated,
      rankingMode: input.rankingMode ?? "deterministic",
      expiresAt: new Date(now.getTime() + ttl),
    },
    select: { id: true },
  });
}

export type LoadWindowFailure =
  | "expired"
  | "unknown"
  | "actor-mismatch"
  | "binding-mismatch"
  | "epoch-changed";

export interface LoadedWindow {
  id: string;
  entries: WindowEntry[];
  truncated: boolean;
  bindingDigest: string;
  /** The mode the stored order was produced under, as recorded. */
  rankingMode: WindowRankingMode;
}

/**
 * A window only loads for the actor, query and authorization clocks it was
 * built for. Any mismatch is a restart, and a restart never carries stale
 * result data with it.
 */
export async function loadResultWindow(input: {
  windowId: string;
  workspaceId: string;
  actor: FileActor;
  /**
   * Omitted when there is no request to derive it from, e.g. turning a
   * window into a bulk selection. The actor and epoch checks still apply.
   */
  bindingDigest?: string;
  epochVector: string;
  now?: Date;
}): Promise<{ window: LoadedWindow } | { failure: LoadWindowFailure }> {
  const now = input.now ?? new Date();
  const record = await prisma.fileResultWindow.findUnique({
    where: { id: input.windowId },
  });

  if (!record) return { failure: "unknown" };
  if (record.expiresAt <= now) return { failure: "expired" };
  if (record.workspaceId !== input.workspaceId)
    return { failure: "actor-mismatch" };
  if (
    record.actorFingerprint !==
    fileActorFingerprint(input.actor, input.workspaceId)
  ) {
    return { failure: "actor-mismatch" };
  }
  if (
    input.bindingDigest !== undefined &&
    record.bindingDigest !== input.bindingDigest
  ) {
    return { failure: "binding-mismatch" };
  }
  if (record.epochVector !== input.epochVector) {
    return { failure: "epoch-changed" };
  }

  return {
    window: {
      id: record.id,
      entries: record.entries as unknown as WindowEntry[],
      truncated: record.truncated,
      bindingDigest: record.bindingDigest,
      // Read back rather than re-derived. "model" is the only other value
      // ever written, and anything else is treated as the safe one.
      rankingMode: record.rankingMode === "model" ? "model" : "deterministic",
    },
  };
}

/**
 * Drop result windows nobody can read again.
 *
 * `loadResultWindow` refuses a record whose `expiresAt` has passed, so a
 * row past that point is unreachable by every code path there is. Nothing
 * deleted them: the model was used exactly twice, `create` on a new search
 * and `findUnique` on a cursor, and the table grew one row per search per
 * actor, each carrying a JSON array of up to `RESULT_WINDOW_LIMIT` result
 * positions, forever.
 *
 * `@@index([expiresAt])` has been on the model from the start with no
 * reader. This is the sweep it was for.
 *
 * Deleting on the same predicate the reader refuses on means this can
 * never remove a window a cursor could still follow: a row it deletes is
 * one `loadResultWindow` would already have answered "expired" for.
 */
export async function pruneExpiredResultWindows(input?: {
  now?: Date;
}): Promise<number> {
  const { count } = await prisma.fileResultWindow.deleteMany({
    where: { expiresAt: { lt: input?.now ?? new Date() } },
  });
  return count;
}

export interface WindowPageInput {
  entries: WindowEntry[];
  from: number;
  limit: number;
  /** Current revisions for the scanned entries, by resource id. */
  current: Map<string, { contentRevision: number; metadataRevision: number }>;
  /**
   * How many entries from `from` the `current` map actually covers.
   *
   * Absence from `current` means two very different things: "this resource
   * is gone" for an entry that was looked up, and "nobody asked" for one
   * beyond the caller's prefetch. Conflating them dropped **live** files:
   * the caller fetched `limit + 20` entries, and once more than 20 had
   * genuinely moved the walk ran past the prefetch and counted every
   * further entry as missing. `nextPosition` then advanced past them, so
   * they never came back on a later page either.
   *
   * The walk stops here instead, and the caller fetches more.
   */
  available?: number;
}

export interface WindowPage {
  resourceIds: string[];
  /** Position after every scanned slot, including the ones that dropped out. */
  nextPosition: number;
  hasMore: boolean;
  scanned: number;
  omitted: number;
}

/**
 * Walk positions from `from`, keeping entries whose revisions still match and
 * dropping the ones that moved. The next offset counts *scanned* positions,
 * not returned items: if 22 positions yielded 20 rows, the next page starts
 * at 22, so nothing is duplicated and nothing unchanged is skipped.
 */
export function takeWindowPage(input: WindowPageInput): WindowPage {
  const limit = Math.min(Math.max(input.limit, 1), SEARCH_PAGE_MAX);
  const resourceIds: string[] = [];
  const start = Math.min(Math.max(input.from, 0), input.entries.length);
  let position = start;
  let omitted = 0;

  // Never walk past what `current` can answer for.
  const end =
    input.available === undefined
      ? input.entries.length
      : Math.min(input.entries.length, start + Math.max(input.available, 0));

  while (position < end && resourceIds.length < limit) {
    const entry = input.entries[position];
    position += 1;

    const live = input.current.get(entry.r);
    if (!live) {
      omitted += 1;
      continue;
    }
    if (live.contentRevision !== entry.c || live.metadataRevision !== entry.m) {
      // The entry still exists but is not the thing this order ranked. It is
      // omitted rather than substituted, so the snapshot stays a snapshot.
      omitted += 1;
      continue;
    }
    resourceIds.push(entry.r);
  }

  return {
    resourceIds,
    nextPosition: position,
    hasMore: position < input.entries.length,
    scanned: position - start,
    omitted,
  };
}
