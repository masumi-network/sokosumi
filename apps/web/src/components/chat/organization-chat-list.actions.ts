"use server";

import type { ChatRoom } from "@/lib/clients/generated/core";
import { chatRoomService } from "@/lib/services";

type OrganizationChatListActionResult =
  | { ok: true; data: ChatRoom[] }
  | { ok: false };

type MarkOrganizationChatReadActionResult =
  | { ok: true; data: ChatRoom }
  | { ok: false };

export async function listOrganizationChatRoomsAction(): Promise<OrganizationChatListActionResult> {
  try {
    // With no active org, Core lists personal coworker directs only.
    const rooms = await chatRoomService.listRooms();
    return { ok: true, data: rooms };
  } catch {
    return { ok: false };
  }
}

export async function markOrganizationChatRoomReadAction(
  roomId: string,
): Promise<MarkOrganizationChatReadActionResult> {
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
