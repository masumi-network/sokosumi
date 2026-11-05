import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import {
  getChatsInvitationsResponseTransformer,
  getChatsRoomsElsewhereResponseTransformer,
  getChatsRoomsResponseTransformer,
} from "@sokosumi/core-client/transformers";

import { fetchBackgroundJson } from "./fetch-background-json";

const SIDEBAR_ROOM_REQUEST_TIMEOUT_MS = 20_000;

interface SidebarRoomsPage {
  rooms: ChatRoom[];
  nextCursor: string | null;
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
  collection: "active" | "archived" | "elsewhere" | "invitations",
): Promise<SidebarRoomsPage | ChatRoom[] | ChatRoomInvitation[] | null> {
  const data = await fetchBackgroundJson(
    `/api/chat/rooms?collection=${collection}`,
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
  );
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
