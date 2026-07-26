"use server";

import { revalidatePath } from "next/cache";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type {
  ChatChannel,
  ChatChannelMessage,
} from "@/lib/clients/generated/core";
import { chatChannelService, userService } from "@/lib/services";

export type ChannelActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

interface CreateChannelInput {
  name: string;
  topic?: string;
  memberUserIds?: string[];
  coworkerIds?: string[];
}

interface UpdateChannelInput {
  name?: string;
  topic?: string | null;
  memberUserIds?: string[];
  coworkerIds?: string[];
}

interface CreateDirectChannelInput {
  memberUserId?: string;
  coworkerId?: string;
  memberUserIds?: string[];
  coworkerIds?: string[];
}

interface SendNewDirectMessageInput {
  memberUserIds?: string[];
  coworkerIds?: string[];
  content: string;
  mentionedCoworkerIds?: string[];
}

interface SendNewChannelMessageInput {
  name: string;
  topic?: string;
  memberUserIds?: string[];
  coworkerIds?: string[];
  content: string;
  mentionedCoworkerIds?: string[];
}

interface SendNewDirectMessageResult {
  channel: ChatChannel;
  message: ChatChannelMessage;
}

function cleanString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function cleanIds(value: string[] | null | undefined): string[] {
  return Array.from(
    new Set((value ?? []).map((id) => id.trim()).filter(Boolean)),
  );
}

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof CoreApiRequestError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export async function createChannelAction(
  input: CreateChannelInput,
): Promise<ChannelActionResult<ChatChannel>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: false, message: "Select an organization first." };
  }

  const name = cleanString(input.name);
  if (!name) {
    return { ok: false, message: "Channel name is required." };
  }

  try {
    const channel = await chatChannelService.createChannel({
      organizationId: activeOrganization.id,
      name,
      topic: cleanString(input.topic),
      memberUserIds: cleanIds(input.memberUserIds),
      coworkerIds: cleanIds(input.coworkerIds),
    });
    revalidatePath("/channels");
    return { ok: true, data: channel };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not create channel."),
    };
  }
}

export async function createDirectChannelAction(
  input: CreateDirectChannelInput,
): Promise<ChannelActionResult<ChatChannel>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: false, message: "Select an organization first." };
  }

  const cleanMemberUserId = cleanString(input.memberUserId);
  const cleanCoworkerId = cleanString(input.coworkerId);
  const memberUserIds = cleanIds([
    ...(cleanMemberUserId ? [cleanMemberUserId] : []),
    ...(input.memberUserIds ?? []),
  ]);
  const coworkerIds = cleanIds([
    ...(cleanCoworkerId ? [cleanCoworkerId] : []),
    ...(input.coworkerIds ?? []),
  ]);

  if (memberUserIds.length + coworkerIds.length === 0) {
    return { ok: false, message: "Choose at least one direct message target." };
  }

  try {
    const channel = await chatChannelService.createDirectChannel({
      organizationId: activeOrganization.id,
      memberUserIds,
      coworkerIds,
    });
    revalidatePath("/channels");
    return { ok: true, data: channel };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not start direct message."),
    };
  }
}

export async function sendNewDirectMessageAction(
  input: SendNewDirectMessageInput,
): Promise<ChannelActionResult<SendNewDirectMessageResult>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: false, message: "Select an organization first." };
  }

  const memberUserIds = cleanIds(input.memberUserIds);
  const coworkerIds = cleanIds(input.coworkerIds);
  if (memberUserIds.length + coworkerIds.length === 0) {
    return { ok: false, message: "Choose at least one direct message target." };
  }

  const cleanContent = cleanString(input.content);
  if (!cleanContent) {
    return { ok: false, message: "Message is required." };
  }

  try {
    const channel = await chatChannelService.createDirectChannel({
      organizationId: activeOrganization.id,
      memberUserIds,
      coworkerIds,
    });
    const message = await chatChannelService.sendMessage(channel.id, {
      content: cleanContent,
      mentionedCoworkerIds: cleanIds(input.mentionedCoworkerIds),
    });
    revalidatePath("/channels");
    return { ok: true, data: { channel, message } };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not start direct message."),
    };
  }
}

export async function sendNewChannelMessageAction(
  input: SendNewChannelMessageInput,
): Promise<ChannelActionResult<SendNewDirectMessageResult>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: false, message: "Select an organization first." };
  }

  const name = cleanString(input.name);
  if (!name) {
    return { ok: false, message: "Channel name is required." };
  }

  const cleanContent = cleanString(input.content);
  if (!cleanContent) {
    return { ok: false, message: "Message is required." };
  }

  try {
    const channel = await chatChannelService.createChannel({
      organizationId: activeOrganization.id,
      name,
      topic: cleanString(input.topic),
      memberUserIds: cleanIds(input.memberUserIds),
      coworkerIds: cleanIds(input.coworkerIds),
    });
    const message = await chatChannelService.sendMessage(channel.id, {
      content: cleanContent,
      mentionedCoworkerIds: cleanIds(input.mentionedCoworkerIds),
    });
    revalidatePath("/channels");
    return { ok: true, data: { channel, message } };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not create channel."),
    };
  }
}

export async function updateChannelAction(
  channelId: string,
  input: UpdateChannelInput,
): Promise<ChannelActionResult<ChatChannel>> {
  const body = {
    ...(input.name !== undefined && { name: cleanString(input.name) }),
    ...(input.topic !== undefined && { topic: cleanString(input.topic) }),
    ...(input.memberUserIds !== undefined && {
      memberUserIds: cleanIds(input.memberUserIds),
    }),
    ...(input.coworkerIds !== undefined && {
      coworkerIds: cleanIds(input.coworkerIds),
    }),
  };

  try {
    const channel = await chatChannelService.updateChannel(channelId, body);
    revalidatePath("/channels");
    return { ok: true, data: channel };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not update channel."),
    };
  }
}

export async function sendChannelMessageAction(
  channelId: string,
  content: string,
  mentionedCoworkerIds: string[],
  parentMessageId?: string,
): Promise<ChannelActionResult<ChatChannelMessage>> {
  const cleanContent = cleanString(content);
  if (!cleanContent) {
    return { ok: false, message: "Message is required." };
  }

  try {
    const message = await chatChannelService.sendMessage(channelId, {
      content: cleanContent,
      mentionedCoworkerIds: cleanIds(mentionedCoworkerIds),
      ...(parentMessageId && { parentMessageId }),
    });
    revalidatePath("/channels");
    return { ok: true, data: message };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not send message."),
    };
  }
}

export async function listChannelMessagesAction(
  channelId: string,
): Promise<ChannelActionResult<ChatChannelMessage[]>> {
  try {
    const messages = await chatChannelService.listMessages(channelId);
    return { ok: true, data: messages };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not load messages."),
    };
  }
}

export async function listThreadMessagesAction(
  channelId: string,
  parentMessageId: string,
): Promise<ChannelActionResult<ChatChannelMessage[]>> {
  try {
    const messages = await chatChannelService.listThreadMessages(
      channelId,
      parentMessageId,
    );
    return { ok: true, data: messages };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not load thread."),
    };
  }
}

export async function toggleMessageReactionAction(
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<ChannelActionResult<ChatChannelMessage>> {
  const cleanEmoji = cleanString(emoji);
  if (!cleanEmoji) {
    return { ok: false, message: "Reaction is required." };
  }

  try {
    const message = await chatChannelService.toggleReaction(
      channelId,
      messageId,
      cleanEmoji,
    );
    revalidatePath("/channels");
    return { ok: true, data: message };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not update reaction."),
    };
  }
}
