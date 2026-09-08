import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";
import {
  getChatsInvitationsResponseTransformer,
  getChatsRoomsResponseTransformer,
} from "@/lib/clients/generated/core/transformers.gen";

const SIDEBAR_ROOM_REQUEST_TIMEOUT_MS = 20_000;

interface SidebarRoomsPage {
  rooms: ChatRoom[];
  nextCursor: string | null;
}

export function fetchSidebarRoomCollection(
  collection: "invitations",
): Promise<ChatRoomInvitation[] | null>;
export function fetchSidebarRoomCollection(
  collection: "active" | "archived",
): Promise<SidebarRoomsPage | null>;
export async function fetchSidebarRoomCollection(
  collection: "active" | "archived" | "invitations",
): Promise<SidebarRoomsPage | ChatRoomInvitation[] | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`/api/chat/rooms?collection=${collection}`, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok || response.redirected) return null;
    const data: unknown = await response.json();
    if (collection === "invitations") {
      return (await getChatsInvitationsResponseTransformer(data)).data;
    }
    const page = await getChatsRoomsResponseTransformer(data);
    return {
      rooms: page.data,
      nextCursor: page.meta.pagination.nextCursor,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
