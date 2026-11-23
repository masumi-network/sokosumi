import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import {
  getChatsInvitationsResponseTransformer,
  getChatsRoomsByIdResponseTransformer,
  getChatsRoomsElsewhereResponseTransformer,
  getChatsRoomsResponseTransformer,
} from "@sokosumi/core-client/transformers";
import { CancelledError } from "@tanstack/react-query";
import type { ChatQueryScope } from "@/queries/chat";

import { fetchBackgroundJson } from "./fetch-background-json";

const SIDEBAR_ROOM_REQUEST_TIMEOUT_MS = 20_000;

/** Sentinel for a response whose session workspace no longer matches the query key. */
const WORKSPACE_MISMATCH = Symbol("workspace-mismatch");

interface SidebarRoomsPage {
  rooms: ChatRoom[];
  nextCursor: string | null;
}

type SidebarRoomCollection =
  | "active"
  | "archived"
  | "elsewhere"
  | "invitations";

interface ScopedBatch {
  expectedScope?: ChatQueryScope;
  collections: Map<SidebarRoomCollection, ((raw: unknown) => void)[]>;
}

let queuedReads: Map<string, ScopedBatch> | null = null;

function scopeBatchKey(expectedScope?: ChatQueryScope): string {
  return expectedScope
    ? `${expectedScope.userId ?? ""}\0${expectedScope.workspaceId ?? ""}`
    : "";
}

function withWorkspaceParam(
  url: string,
  expectedScope?: ChatQueryScope,
): string {
  if (!expectedScope) return url;
  return `${url}&organizationId=${encodeURIComponent(expectedScope.workspaceId ?? "")}`;
}

function matchesExpectedScope(
  raw: unknown,
  expectedScope?: ChatQueryScope,
): boolean {
  if (!expectedScope || raw == null || typeof raw !== "object") return true;
  const scope = (raw as { scope?: unknown }).scope;
  if (!scope || typeof scope !== "object") return true;
  const { userId, organizationId } = scope as {
    userId?: unknown;
    organizationId?: unknown;
  };
  return (
    userId === expectedScope.userId &&
    (organizationId ?? null) === expectedScope.workspaceId
  );
}

async function readOneCollection(
  collection: SidebarRoomCollection,
  expectedScope?: ChatQueryScope,
): Promise<unknown> {
  let status: number | undefined;
  const raw = await fetchBackgroundJson(
    withWorkspaceParam(
      `/api/chat/rooms?collection=${collection}`,
      expectedScope,
    ),
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
    (answered) => {
      status = answered;
    },
  );
  if (status === 409 || !matchesExpectedScope(raw, expectedScope)) {
    return WORKSPACE_MISMATCH;
  }
  return raw;
}

async function readQueuedParts(
  collections: SidebarRoomCollection[],
  expectedScope?: ChatQueryScope,
): Promise<Map<SidebarRoomCollection, unknown>> {
  if (collections.length === 1) {
    return new Map([
      [collections[0], await readOneCollection(collections[0], expectedScope)],
    ]);
  }
  let status: number | undefined;
  const raw = await fetchBackgroundJson(
    withWorkspaceParam(
      `/api/chat/rooms?collections=${collections.join(",")}`,
      expectedScope,
    ),
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
    (answered) => {
      status = answered;
    },
  );
  if (status === 409 || !matchesExpectedScope(raw, expectedScope)) {
    return new Map(collections.map((c) => [c, WORKSPACE_MISMATCH]));
  }
  // A server from before batched reads refuses the list: ask one by one.
  if (status === 400) {
    const answers = await Promise.all(
      collections.map((c) => readOneCollection(c, expectedScope)),
    );
    return new Map(collections.map((c, index) => [c, answers[index]]));
  }
  const parts = (raw as { data?: Record<string, unknown> } | null)?.data;
  // A part whose read never reached Core is asked for again on its own, so
  // it gets another try plus the retries a stalled read gets. The other
  // parts answer at once and do not wait for it.
  return new Map(
    collections.map((c) => {
      const part = parts?.[c] ?? null;
      const stalled = (part as { stalled?: unknown } | null)?.stalled;
      return [c, stalled === true ? readOneCollection(c, expectedScope) : part];
    }),
  );
}

async function sendQueuedReads(): Promise<void> {
  const batches = queuedReads;
  queuedReads = null;
  if (!batches) return;
  await Promise.all(
    [...batches.values()].map(async ({ expectedScope, collections }) => {
      // Every caller settles, even if the read threw: null, like any failure.
      const parts = await readQueuedParts(
        [...collections.keys()],
        expectedScope,
      ).catch(() => new Map<SidebarRoomCollection, unknown>());
      await Promise.all(
        [...collections].map(async ([collection, waiters]) => {
          const part = await Promise.resolve(
            parts.get(collection) ?? null,
          ).catch(() => null);
          // Each caller transforms its own copy: the generated transformers
          // rewrite dates in place.
          waiters.forEach((resolve, index) => {
            resolve(
              index === 0 || part == null || part === WORKSPACE_MISMATCH
                ? part
                : structuredClone(part),
            );
          });
        }),
      );
    }),
  );
}

/**
 * Reads asked for in the same task for the same workspace (the list's active
 * and invitation reads on mount, say) go out as one request, so they cost one
 * session read in the route instead of one each. Each caller still gets only
 * its own collection.
 */
function readCollectionJson(
  collection: SidebarRoomCollection,
  expectedScope?: ChatQueryScope,
): Promise<unknown> {
  return new Promise((resolve) => {
    if (!queuedReads) {
      queuedReads = new Map();
      queueMicrotask(() => void sendQueuedReads());
    }
    const key = scopeBatchKey(expectedScope);
    let batch = queuedReads.get(key);
    if (!batch) {
      batch = { expectedScope, collections: new Map() };
      queuedReads.set(key, batch);
    }
    const waiters = batch.collections.get(collection) ?? [];
    waiters.push(resolve);
    batch.collections.set(collection, waiters);
  });
}

export function fetchSidebarRoomCollection(
  collection: "invitations",
  expectedScope?: ChatQueryScope,
): Promise<ChatRoomInvitation[] | null>;
export function fetchSidebarRoomCollection(
  collection: "elsewhere",
  expectedScope?: ChatQueryScope,
): Promise<ChatRoom[] | null>;
export function fetchSidebarRoomCollection(
  collection: "active" | "archived",
  expectedScope?: ChatQueryScope,
): Promise<SidebarRoomsPage | null>;
export async function fetchSidebarRoomCollection(
  collection: SidebarRoomCollection,
  expectedScope?: ChatQueryScope,
): Promise<SidebarRoomsPage | ChatRoom[] | ChatRoomInvitation[] | null> {
  const data = await readCollectionJson(collection, expectedScope);
  if (data === WORKSPACE_MISMATCH) {
    throw new CancelledError({ revert: true });
  }
  if (data == null) return null;
  try {
    if (collection === "invitations") {
      return (await getChatsInvitationsResponseTransformer(data)).data;
    }
    if (collection === "elsewhere") {
      return (await getChatsRoomsElsewhereResponseTransformer(data)).data;
    }
    const page = await getChatsRoomsResponseTransformer(data);
    return {
      rooms: page.data,
      nextCursor: page.meta.pagination.nextCursor,
    };
  } catch {
    return null;
  }
}

/**
 * One room as the sidebar lists it. `"gone"` when Core answered that the
 * reader can no longer open the room; null when the read failed, like every
 * other background read.
 */
export async function fetchSidebarRoom(
  roomId: string,
  expectedScope?: ChatQueryScope,
): Promise<ChatRoom | "gone" | null> {
  let status: number | undefined;
  const data = await fetchBackgroundJson(
    withWorkspaceParam(
      `/api/chat/rooms?roomId=${encodeURIComponent(roomId)}`,
      expectedScope,
    ),
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
    (answered) => {
      status = answered;
    },
  );
  if (status === 409 || !matchesExpectedScope(data, expectedScope)) {
    return null;
  }
  if (data == null) return null;
  if ((data as { data?: unknown }).data === null) return "gone";
  try {
    return (await getChatsRoomsByIdResponseTransformer(data)).data;
  } catch {
    return null;
  }
}
