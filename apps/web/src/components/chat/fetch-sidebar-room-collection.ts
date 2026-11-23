import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import {
  getChatsInvitationsResponseTransformer,
  getChatsRoomsByIdResponseTransformer,
  getChatsRoomsElsewhereResponseTransformer,
  getChatsRoomsResponseTransformer,
} from "@sokosumi/core-client/transformers";

import { fetchBackgroundJson } from "./fetch-background-json";

const SIDEBAR_ROOM_REQUEST_TIMEOUT_MS = 20_000;

interface SidebarRoomsPage {
  rooms: ChatRoom[];
  nextCursor: string | null;
}

type SidebarRoomCollection =
  | "active"
  | "archived"
  | "elsewhere"
  | "invitations";

interface CollectionWaiter {
  resolve: (raw: unknown) => void;
  signal?: AbortSignal;
}

let queuedReads: Map<SidebarRoomCollection, CollectionWaiter[]> | null = null;

function linkAbortSignals(waiters: readonly CollectionWaiter[]): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  if (waiters.length === 0 || waiters.some((waiter) => !waiter.signal)) {
    return { signal: undefined, cleanup: () => {} };
  }
  const controller = new AbortController();
  const onAbort = () => {
    if (waiters.every((waiter) => waiter.signal?.aborted)) {
      controller.abort();
    }
  };
  for (const waiter of waiters) {
    waiter.signal?.addEventListener("abort", onAbort, { once: true });
  }
  onAbort();
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const waiter of waiters) {
        waiter.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

function readOneCollection(
  collection: SidebarRoomCollection,
  signal?: AbortSignal,
) {
  return fetchBackgroundJson(
    `/api/chat/rooms?collection=${collection}`,
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
    undefined,
    signal,
  );
}

async function readQueuedParts(
  collections: SidebarRoomCollection[],
  signal?: AbortSignal,
): Promise<Map<SidebarRoomCollection, unknown>> {
  if (collections.length === 1) {
    return new Map([
      [collections[0], await readOneCollection(collections[0], signal)],
    ]);
  }
  let status: number | undefined;
  const raw = await fetchBackgroundJson(
    `/api/chat/rooms?collections=${collections.join(",")}`,
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
    (answered) => {
      status = answered;
    },
    signal,
  );
  // A server from before batched reads refuses the list: ask one by one.
  if (status === 400) {
    const answers = await Promise.all(
      collections.map((c) => readOneCollection(c, signal)),
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
      return [c, stalled === true ? readOneCollection(c, signal) : part];
    }),
  );
}

async function sendQueuedReads(): Promise<void> {
  const batch = queuedReads;
  queuedReads = null;
  if (!batch) return;
  const { signal, cleanup } = linkAbortSignals([...batch.values()].flat());
  try {
    // Every caller settles, even if the read threw: null, like any failure.
    const parts = await readQueuedParts([...batch.keys()], signal).catch(
      () => new Map<SidebarRoomCollection, unknown>(),
    );
    await Promise.all(
      [...batch].map(async ([collection, waiters]) => {
        const part = await Promise.resolve(parts.get(collection) ?? null).catch(
          () => null,
        );
        // Each caller transforms its own copy: the generated transformers
        // rewrite dates in place.
        waiters.forEach(({ resolve }, index) => {
          resolve(index === 0 || part == null ? part : structuredClone(part));
        });
      }),
    );
  } finally {
    cleanup();
  }
}

/**
 * Reads asked for in the same task (the list's active and invitation reads on
 * mount, say) go out as one request, so they cost one session read in the
 * route instead of one each. Each caller still gets only its own collection.
 */
function readCollectionJson(
  collection: SidebarRoomCollection,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve) => {
    if (!queuedReads) {
      queuedReads = new Map();
      queueMicrotask(() => void sendQueuedReads());
    }
    const waiters = queuedReads.get(collection) ?? [];
    waiters.push({ resolve, signal });
    queuedReads.set(collection, waiters);
  });
}

export function fetchSidebarRoomCollection(
  collection: "invitations",
  signal?: AbortSignal,
): Promise<ChatRoomInvitation[] | null>;
export function fetchSidebarRoomCollection(
  collection: "elsewhere",
  signal?: AbortSignal,
): Promise<ChatRoom[] | null>;
export function fetchSidebarRoomCollection(
  collection: "active" | "archived",
  signal?: AbortSignal,
): Promise<SidebarRoomsPage | null>;
export async function fetchSidebarRoomCollection(
  collection: SidebarRoomCollection,
  signal?: AbortSignal,
): Promise<SidebarRoomsPage | ChatRoom[] | ChatRoomInvitation[] | null> {
  const data = await readCollectionJson(collection, signal);
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
): Promise<ChatRoom | "gone" | null> {
  const data = await fetchBackgroundJson(
    `/api/chat/rooms?roomId=${encodeURIComponent(roomId)}`,
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
  );
  if (data == null) return null;
  if ((data as { data?: unknown }).data === null) return "gone";
  try {
    return (await getChatsRoomsByIdResponseTransformer(data)).data;
  } catch {
    return null;
  }
}
