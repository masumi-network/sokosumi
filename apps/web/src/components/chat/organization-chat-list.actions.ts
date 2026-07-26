"use server";

import { revalidatePath } from "next/cache";
import type { ChatChannel } from "@/lib/clients/generated/core";
import { chatChannelService, userService } from "@/lib/services";

type OrganizationChatListActionResult =
  | { ok: true; data: ChatChannel[] }
  | { ok: false };

type MarkOrganizationChatReadActionResult =
  | { ok: true; data: ChatChannel }
  | { ok: false };

export async function listOrganizationChatChannelsAction(): Promise<OrganizationChatListActionResult> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: true, data: [] };
  }

  try {
    const channels = await chatChannelService.listChannels(
      activeOrganization.id,
    );
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
    const channel = await chatChannelService.markRead(cleanChannelId);
    revalidatePath("/channels");
    return { ok: true, data: channel };
  } catch {
    return { ok: false };
  }
}
