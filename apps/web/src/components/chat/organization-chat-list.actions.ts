"use server";

import type { ChatRoom } from "@/lib/clients/generated/core";
import { chatRoomService } from "@/lib/services";

type OrganizationChatListActionResult =
  | { ok: true; data: ChatRoom[]; nextCursor: string | null }
  | { ok: false };

type OrganizationChatRoomMutationResult =
  | { ok: true; data: ChatRoom }
  | { ok: false };

export async function listOrganizationChatRoomsAction(): Promise<OrganizationChatListActionResult> {
  try {
    // With no active org, Core lists personal coworker directs only.
    const page = await chatRoomService.listRooms();
    return { ok: true, data: page.rooms, nextCursor: page.nextCursor };
  } catch {
    return { ok: false };
  }
}

export async function listOrganizationArchivedChatRoomsAction(): Promise<OrganizationChatListActionResult> {
  try {
    const page = await chatRoomService.listArchivedRooms();
    return { ok: true, data: page.rooms, nextCursor: page.nextCursor };
  } catch {
    return { ok: false };
  }
}

export async function loadMoreOrganizationChatRoomsAction(
  cursor: string,
): Promise<OrganizationChatListActionResult> {
  const cleanCursor = cursor.trim();
  if (!cleanCursor) {
    return { ok: false };
  }

  try {
    const page = await chatRoomService.listRooms(undefined, "active", {
      cursor: cleanCursor,
    });
    return { ok: true, data: page.rooms, nextCursor: page.nextCursor };
  } catch {
    return { ok: false };
  }
}

export async function loadMoreOrganizationArchivedChatRoomsAction(
  cursor: string,
): Promise<OrganizationChatListActionResult> {
  const cleanCursor = cursor.trim();
  if (!cleanCursor) {
    return { ok: false };
  }

  try {
    const page = await chatRoomService.listArchivedRooms({
      cursor: cleanCursor,
    });
    return { ok: true, data: page.rooms, nextCursor: page.nextCursor };
  } catch {
    return { ok: false };
  }
}

export async function markOrganizationChatRoomReadAction(
  roomId: string,
): Promise<OrganizationChatRoomMutationResult> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return { ok: false };
  }

  try {
    const room = await chatRoomService.markRead(cleanRoomId);
    // No revalidatePath: sidebar updates via custom event + poll. Revalidating
    // /chat would re-fetch only the latest message page and wipe older ones.
    return { ok: true, data: room };
  } catch {
    return { ok: false };
  }
}

export async function pinOrganizationChatRoomAction(
  roomId: string,
): Promise<OrganizationChatRoomMutationResult> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return { ok: false };
  }

  try {
    const room = await chatRoomService.pinRoom(cleanRoomId);
    return { ok: true, data: room };
  } catch {
    return { ok: false };
  }
}

export async function unpinOrganizationChatRoomAction(
  roomId: string,
): Promise<OrganizationChatRoomMutationResult> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return { ok: false };
  }

  try {
    const room = await chatRoomService.unpinRoom(cleanRoomId);
    return { ok: true, data: room };
  } catch {
    return { ok: false };
  }
}

export async function muteOrganizationChatRoomAction(
  roomId: string,
): Promise<OrganizationChatRoomMutationResult> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return { ok: false };
  }

  try {
    const room = await chatRoomService.muteRoom(cleanRoomId);
    return { ok: true, data: room };
  } catch {
    return { ok: false };
  }
}

export async function unmuteOrganizationChatRoomAction(
  roomId: string,
): Promise<OrganizationChatRoomMutationResult> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return { ok: false };
  }

  try {
    const room = await chatRoomService.unmuteRoom(cleanRoomId);
    return { ok: true, data: room };
  } catch {
    return { ok: false };
  }
}

export async function markOrganizationChatRoomUnreadAction(
  roomId: string,
): Promise<OrganizationChatRoomMutationResult> {
  const cleanRoomId = roomId.trim();
  if (!cleanRoomId) {
    return { ok: false };
  }

  try {
    const room = await chatRoomService.markUnread(cleanRoomId);
    return { ok: true, data: room };
  } catch {
    return { ok: false };
  }
}
