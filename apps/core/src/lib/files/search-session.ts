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

export async function createResultWindow(input: {
  workspaceId: string;
  actor: FileActor;
  kind: FileResultWindowKind;
  bindingDigest: string;
  epochVector: string;
  entries: WindowEntry[];
  truncated: boolean;
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
    },
  };
}

export interface WindowPageInput {
  entries: WindowEntry[];
  from: number;
  limit: number;
  /** Current revisions for the scanned entries, by resource id. */
  current: Map<string, { contentRevision: number; metadataRevision: number }>;
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
  let position = Math.min(Math.max(input.from, 0), input.entries.length);
  let omitted = 0;

  while (position < input.entries.length && resourceIds.length < limit) {
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
    scanned: position - Math.min(Math.max(input.from, 0), input.entries.length),
    omitted,
  };
}
