"use server";

import { revalidatePath } from "next/cache";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { ChatRoom, ChatRoomMessage } from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";

export type RoomActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

interface CreateChannelInput {
  name: string;
  topic?: string;
  memberUserIds?: string[];
  coworkerIds?: string[];
}

interface UpdateRoomInput {
  name?: string;
  topic?: string | null;
  memberUserIds?: string[];
  coworkerIds?: string[];
}

interface CreateDirectRoomInput {
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
  room: ChatRoom;
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

/** Direct rooms are 1:1 only until group DM ships. */
function oneToOneDirectError(
  memberUserIds: readonly string[],
  coworkerIds: readonly string[],
): string | null {
  const isOneHuman = memberUserIds.length === 1 && coworkerIds.length === 0;
  const isOneCoworker = memberUserIds.length === 0 && coworkerIds.length === 1;
  if (isOneHuman || isOneCoworker) {
    return null;
  }
  if (memberUserIds.length + coworkerIds.length === 0) {
    return "Choose at least one direct message target.";
  }
  return "Direct messages are 1:1. Pick one member or one coworker.";
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
): Promise<RoomActionResult<ChatRoom>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: false, message: "Select an organization first." };
  }

  const name = cleanString(input.name);
  if (!name) {
    return { ok: false, message: "Channel name is required." };
  }

  try {
    const room = await chatRoomService.createRoom({
      kind: "channel",
      name,
      topic: cleanString(input.topic),
      memberUserIds: cleanIds(input.memberUserIds),
      coworkerIds: cleanIds(input.coworkerIds),
    });
    revalidatePath("/chat");
    return { ok: true, data: room };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not create channel."),
    };
  }
}

export async function createDirectRoomAction(
  input: CreateDirectRoomInput,
): Promise<RoomActionResult<ChatRoom>> {
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

  const oneToOneError = oneToOneDirectError(memberUserIds, coworkerIds);
  if (oneToOneError) {
    return { ok: false, message: oneToOneError };
  }

  // Human 1:1 needs an org (teammate roster). Coworker 1:1 uses active org
  // when set; Core stores null only with no active organization.
  if (memberUserIds.length === 1) {
    const activeOrganization = await userService.getActiveOrganization();
    if (!activeOrganization) {
      return { ok: false, message: "Select an organization first." };
    }
  }

  try {
    const room = await chatRoomService.createRoom({
      kind: "direct",
      memberUserIds,
      coworkerIds,
    });
    revalidatePath("/chat");
    return { ok: true, data: room };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not start direct message."),
    };
  }
}

/**
 * Create-or-get the `kind:direct` room for a solo coworker 1:1.
 * Uses the active organization when set (same as `/chat`); personal if none.
 */
export async function ensureCoworkerDirectRoomAction(
  coworkerId: string,
): Promise<RoomActionResult<ChatRoom | null>> {
  const cleanCoworkerId = cleanString(coworkerId);
  if (!cleanCoworkerId) {
    return { ok: false, message: "Coworker is required." };
  }

  try {
    const room = await chatRoomService.createRoom({
      kind: "direct",
      memberUserIds: [],
      coworkerIds: [cleanCoworkerId],
    });
    return { ok: true, data: room };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(
        error,
        "Could not ensure coworker direct room.",
      ),
    };
  }
}

export async function sendNewDirectMessageAction(
  input: SendNewDirectMessageInput,
): Promise<RoomActionResult<SendNewDirectMessageResult>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: false, message: "Select an organization first." };
  }

  const memberUserIds = cleanIds(input.memberUserIds);
  const coworkerIds = cleanIds(input.coworkerIds);
  const oneToOneError = oneToOneDirectError(memberUserIds, coworkerIds);
  if (oneToOneError) {
    return { ok: false, message: oneToOneError };
  }

  const cleanContent = cleanString(input.content);
  if (!cleanContent) {
    return { ok: false, message: "Message is required." };
  }

  try {
    const room = await chatRoomService.createRoom({
      kind: "direct",
      memberUserIds,
      coworkerIds,
    });
    const message = await chatRoomService.sendMessage(room.id, {
      content: cleanContent,
      mentionedCoworkerIds: cleanIds(input.mentionedCoworkerIds),
    });
    revalidatePath("/chat");
    return { ok: true, data: { room, message } };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not start direct message."),
    };
  }
}

export async function sendNewChannelMessageAction(
  input: SendNewChannelMessageInput,
): Promise<RoomActionResult<SendNewDirectMessageResult>> {
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
    const room = await chatRoomService.createRoom({
      kind: "channel",
      name,
      topic: cleanString(input.topic),
      memberUserIds: cleanIds(input.memberUserIds),
      coworkerIds: cleanIds(input.coworkerIds),
    });
    const message = await chatRoomService.sendMessage(room.id, {
      content: cleanContent,
      mentionedCoworkerIds: cleanIds(input.mentionedCoworkerIds),
    });
    revalidatePath("/chat");
    return { ok: true, data: { room, message } };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not create channel."),
    };
  }
}

export async function updateRoomAction(
  roomId: string,
  input: UpdateRoomInput,
): Promise<RoomActionResult<ChatRoom>> {
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
    const room = await chatRoomService.updateRoom(roomId, body);
    revalidatePath("/chat");
    return { ok: true, data: room };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not update channel."),
    };
  }
}

export async function archiveRoomAction(
  roomId: string,
): Promise<RoomActionResult<{ id: string }>> {
  try {
    const archived = await chatRoomService.archiveRoom(roomId);
    // The room disappears from every member's list, so the server-rendered
    // room list has to be rebuilt rather than patched client side.
    revalidatePath("/chat");
    return { ok: true, data: { id: archived.id } };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not archive channel."),
    };
  }
}

export async function leaveRoomAction(
  roomId: string,
): Promise<RoomActionResult<{ id: string }>> {
  try {
    const left = await chatRoomService.leaveRoom(roomId);
    revalidatePath("/chat");
    return { ok: true, data: { id: left.id } };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not leave channel."),
    };
  }
}

export async function sendRoomMessageAction(
  roomId: string,
  content: string,
  mentionedCoworkerIds: string[],
  parentMessageId?: string,
): Promise<RoomActionResult<ChatRoomMessage>> {
  const cleanContent = cleanString(content);
  if (!cleanContent) {
    return { ok: false, message: "Message is required." };
  }

  try {
    const message = await chatRoomService.sendMessage(roomId, {
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

export async function listRoomMessagesAction(
  roomId: string,
  options?: { cursor?: string },
): Promise<
  RoomActionResult<{
    messages: ChatRoomMessage[];
    nextCursor: string | null;
  }>
> {
  try {
    const page = await chatRoomService.listMessages(roomId, {
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
  roomId: string,
  parentMessageId: string,
  options?: { cursor?: string },
): Promise<
  RoomActionResult<{
    messages: ChatRoomMessage[];
    nextCursor: string | null;
  }>
> {
  try {
    const page = await chatRoomService.listThreadMessages(
      roomId,
      parentMessageId,
      { cursor: options?.cursor },
    );
    return { ok: true, data: page };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not load thread."),
    };
  }
}

export async function toggleMessageReactionAction(
  roomId: string,
  messageId: string,
  emoji: string,
): Promise<RoomActionResult<ChatRoomMessage>> {
  const cleanEmoji = cleanString(emoji);
  if (!cleanEmoji) {
    return { ok: false, message: "Reaction is required." };
  }

  try {
    const message = await chatRoomService.toggleReaction(
      roomId,
      messageId,
      cleanEmoji,
    );
    // No revalidatePath: the updated message is returned and merged client
    // side, so a full RSC re-render of /chat would only duplicate work.
    return { ok: true, data: message };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not update reaction."),
    };
  }
}
