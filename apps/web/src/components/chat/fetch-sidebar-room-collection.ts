import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";
import {
  getChatsInvitationsResponseTransformer,
  getChatsRoomsResponseTransformer,
} from "@/lib/clients/generated/core/transformers.gen";

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
  collection: "active" | "archived",
): Promise<SidebarRoomsPage | null>;
export async function fetchSidebarRoomCollection(
  collection: "active" | "archived" | "invitations",
): Promise<SidebarRoomsPage | ChatRoomInvitation[] | null> {
  const data = await fetchBackgroundJson(
    `/api/chat/rooms?collection=${collection}`,
    SIDEBAR_ROOM_REQUEST_TIMEOUT_MS,
  );
  if (data == null) return null;
  try {
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
  }
}
