"use server";

import { err, ok } from "neverthrow";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { type ChatRoomsPage, chatRoomService } from "@/lib/services";

/** Org sidebar / chat list wire shape — ActionResultDto (neverthrow at boundary). */
export type OrganizationChatListActionResult<T> = ActionResultDto<
  T,
  ActionError
>;

function listOk(
  page: ChatRoomsPage,
): OrganizationChatListActionResult<ChatRoomsPage> {
  return toActionResult(ok(page));
}

function roomOk(room: ChatRoom): OrganizationChatListActionResult<ChatRoom> {
  return toActionResult(ok(room));
}

function listFail(
  message: string,
  code: CommonErrorCode = CommonErrorCode.BAD_INPUT,
): OrganizationChatListActionResult<never> {
  return toActionResult(err({ code, message }));
}

function listCatch(fallback: string): OrganizationChatListActionResult<never> {
  return toActionResult(
    err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: fallback,
    }),
  );
}

export async function listOrganizationChatRoomsAction(): Promise<
  OrganizationChatListActionResult<ChatRoomsPage>
> {
  try {
    // With no active org, Core lists personal Directs and guest rooms.
    const page = await chatRoomService.listRooms();
    return listOk(page);
  } catch {
    return listCatch("Could not load chat rooms.");
  }
}

export async function listOrganizationArchivedChatRoomsAction(): Promise<
  OrganizationChatListActionResult<ChatRoomsPage>
> {
  try {
    const page = await chatRoomService.listArchivedRooms();
    return listOk(page);
  } catch {
    return listCatch("Could not load archived chat rooms.");
  }
}

export async function loadMoreOrganizationChatRoomsAction(
  cursor: string,
): Promise<OrganizationChatListActionResult<ChatRoomsPage>> {
  const cleanCursor = cursor.trim();
  if (!cleanCursor) {
    return listFail("Cursor is required.");
  }

  try {
    const page = await chatRoomService.listRooms(undefined, "active", {
      cursor: cleanCursor,
    });
    return listOk(page);
  } catch {
    return listCatch("Could not load more chat rooms.");
  }
}

export async function loadMoreOrganizationArchivedChatRoomsAction(
  cursor: string,
): Promise<OrganizationChatListActionResult<ChatRoomsPage>> {
  const cleanCursor = cursor.trim();
  if (!cleanCursor) {
    return listFail("Cursor is required.");
  }

  try {
    const page = await chatRoomService.listArchivedRooms({
      cursor: cleanCursor,
    });
    return listOk(page);
  } catch {
    return listCatch("Could not load more archived chat rooms.");
  }
}

export async function markOrganizationChatRoomReadAction(
  roomId: string,
): Promise<OrganizationChatListActionResult<ChatRoom>> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return listFail("Room id is required.");
  }

  try {
    const room = await chatRoomService.markRead(cleanRoomId);
    // No revalidatePath: sidebar updates via custom event + poll. Revalidating
    // /chat would re-fetch only the latest message page and wipe older ones.
    return roomOk(room);
  } catch {
    return listCatch("Could not mark room as read.");
  }
}

export async function pinOrganizationChatRoomAction(
  roomId: string,
): Promise<OrganizationChatListActionResult<ChatRoom>> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return listFail("Room id is required.");
  }

  try {
    const room = await chatRoomService.pinRoom(cleanRoomId);
    return roomOk(room);
  } catch {
    return listCatch("Could not pin room.");
  }
}

export async function unpinOrganizationChatRoomAction(
  roomId: string,
): Promise<OrganizationChatListActionResult<ChatRoom>> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return listFail("Room id is required.");
  }

  try {
    const room = await chatRoomService.unpinRoom(cleanRoomId);
    return roomOk(room);
  } catch {
    return listCatch("Could not unpin room.");
  }
}

export async function muteOrganizationChatRoomAction(
  roomId: string,
): Promise<OrganizationChatListActionResult<ChatRoom>> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return listFail("Room id is required.");
  }

  try {
    const room = await chatRoomService.muteRoom(cleanRoomId);
    return roomOk(room);
  } catch {
    return listCatch("Could not mute room.");
  }
}

export async function unmuteOrganizationChatRoomAction(
  roomId: string,
): Promise<OrganizationChatListActionResult<ChatRoom>> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return listFail("Room id is required.");
  }

  try {
    const room = await chatRoomService.unmuteRoom(cleanRoomId);
    return roomOk(room);
  } catch {
    return listCatch("Could not unmute room.");
  }
}

export async function markOrganizationChatRoomUnreadAction(
  roomId: string,
): Promise<OrganizationChatListActionResult<ChatRoom>> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return listFail("Room id is required.");
  }

  try {
    const room = await chatRoomService.markUnread(cleanRoomId);
    return roomOk(room);
  } catch {
    return listCatch("Could not mark room as unread.");
  }
}
