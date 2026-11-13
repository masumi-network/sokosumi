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

let queuedReads: Map<SidebarRoomCollection, ((raw: unknown) => void)[]> | null =
  null;

async function sendQueuedReads(): Promise<void> {
  const batch = queuedReads;
  queuedReads = null;
  if (!batch) return;
  const collections = [...batch.keys()];
  const [only] = collections;
  const raw =
    collections.length === 1
      ? await fetchBackgroundJson(
          `/api/chat/rooms?collection=${only}`,
          SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
        )
      : await fetchBackgroundJson(
          `/api/chat/rooms?collections=${collections.join(",")}`,
          SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
        );
  const parts =
    collections.length === 1
      ? null
      : ((raw as { data?: Record<string, unknown> } | null)?.data ?? null);
  for (const [collection, waiters] of batch) {
    const part = collections.length === 1 ? raw : (parts?.[collection] ?? null);
    // Each caller transforms its own copy: the generated transformers
    // rewrite dates in place.
    waiters.forEach((resolve, index) => {
      resolve(index === 0 || part == null ? part : structuredClone(part));
    });
  }
}

/**
 * Reads asked for in the same task (the list's active and invitation reads on
 * mount, say) go out as one request, so they cost one session read in the
 * route instead of one each. Each caller still gets only its own collection.
 */
function readCollectionJson(
  collection: SidebarRoomCollection,
): Promise<unknown> {
  return new Promise((resolve) => {
    if (!queuedReads) {
      queuedReads = new Map();
      queueMicrotask(() => void sendQueuedReads());
    }
    const waiters = queuedReads.get(collection) ?? [];
    waiters.push(resolve);
    queuedReads.set(collection, waiters);
  });
}

export function fetchSidebarRoomCollection(
  collection: "invitations",
): Promise<ChatRoomInvitation[] | null>;
export function fetchSidebarRoomCollection(
  collection: "elsewhere",
): Promise<ChatRoom[] | null>;
export function fetchSidebarRoomCollection(
  collection: "active" | "archived",
): Promise<SidebarRoomsPage | null>;
export async function fetchSidebarRoomCollection(
  collection: SidebarRoomCollection,
): Promise<SidebarRoomsPage | ChatRoom[] | ChatRoomInvitation[] | null> {
  const data = await readCollectionJson(collection);
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
