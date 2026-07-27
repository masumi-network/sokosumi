"use server";

import type { ChatRoom } from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";

type OrganizationChatListActionResult =
  | { ok: true; data: ChatRoom[] }
  | { ok: false };

type MarkOrganizationChatReadActionResult =
  | { ok: true; data: ChatRoom }
  | { ok: false };

export async function listOrganizationChatChannelsAction(): Promise<OrganizationChatListActionResult> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: true, data: [] };
  }

  try {
    const channels = await chatRoomService.listRooms();
    return { ok: true, data: channels };
  } catch {
    return { ok: false };
  }
}

export async function markOrganizationChatChannelReadAction(
  channelId: string,
): Promise<MarkOrganizationChatReadActionResult> {
  const cleanChannelId = channelId.trim();
  if (!cleanChannelId) {
    return { ok: false };
  }

  try {
    const channel = await chatRoomService.markRead(cleanChannelId);
    // No revalidatePath: sidebar updates via custom event + poll. Revalidating
    // /channels would re-fetch only the latest message page and wipe older ones.
    return { ok: true, data: channel };
  } catch {
    return { ok: false };
  }
}
