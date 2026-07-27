"use server";

import { revalidatePath } from "next/cache";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { ChatRoom, ChatRoomMessage } from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";

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
  channel: ChatRoom;
  message: ChatRoomMessage;
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
): Promise<ChannelActionResult<ChatRoom>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: false, message: "Select an organization first." };
  }

  const name = cleanString(input.name);
  if (!name) {
    return { ok: false, message: "Channel name is required." };
  }

  try {
    const channel = await chatRoomService.createRoom({
      kind: "channel",
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
): Promise<ChannelActionResult<ChatRoom>> {
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
    const channel = await chatRoomService.createRoom({
      kind: "direct",
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
    const channel = await chatRoomService.createRoom({
      kind: "direct",
      memberUserIds,
      coworkerIds,
    });
    const message = await chatRoomService.sendMessage(channel.id, {
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
    const channel = await chatRoomService.createRoom({
      kind: "channel",
      name,
      topic: cleanString(input.topic),
      memberUserIds: cleanIds(input.memberUserIds),
      coworkerIds: cleanIds(input.coworkerIds),
    });
    const message = await chatRoomService.sendMessage(channel.id, {
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
): Promise<ChannelActionResult<ChatRoom>> {
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
    const channel = await chatRoomService.updateRoom(channelId, body);
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
): Promise<ChannelActionResult<ChatRoomMessage>> {
  const cleanContent = cleanString(content);
  if (!cleanContent) {
    return { ok: false, message: "Message is required." };
  }

  try {
    const message = await chatRoomService.sendMessage(channelId, {
      content: cleanContent,
      mentionedCoworkerIds: cleanIds(mentionedCoworkerIds),
      ...(parentMessageId && { parentMessageId }),
    });
    // No revalidatePath: client appends/merges the returned message. Revalidating
    // would re-fetch only the latest page and wipe client-loaded older history.
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
  options?: { cursor?: string },
): Promise<
  ChannelActionResult<{
    messages: ChatRoomMessage[];
    nextCursor: string | null;
  }>
> {
  try {
    const page = await chatRoomService.listMessages(channelId, {
      cursor: options?.cursor,
    });
    return { ok: true, data: page };
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
): Promise<ChannelActionResult<ChatRoomMessage[]>> {
  try {
    const messages = await chatRoomService.listThreadMessages(
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
): Promise<ChannelActionResult<ChatRoomMessage>> {
  const cleanEmoji = cleanString(emoji);
  if (!cleanEmoji) {
    return { ok: false, message: "Reaction is required." };
  }

  try {
    const message = await chatRoomService.toggleReaction(
      channelId,
      messageId,
      cleanEmoji,
    );
    // No revalidatePath: the updated message is returned and merged client
    // side, so a full RSC re-render of /channels would only duplicate work.
    return { ok: true, data: message };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not update reaction."),
    };
  }
}
