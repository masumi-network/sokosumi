"use server";

import { revalidatePath } from "next/cache";
import { actionErrorMessage } from "@/app/chat/action-error-message";
import { directCreateShapeError } from "@/app/chat/utils/direct-create-shape";
import type {
  ChatRoom,
  ChatRoomMessage,
  ChatRoomThreadAttentionItem,
  ChatRoomThreadReadState,
  DiscoverableChatRoom,
} from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";

export type RoomActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

type ChannelDiscoverability = "public" | "private";

interface CreateChannelInput {
  name: string;
  topic?: string;
  discoverability?: ChannelDiscoverability;
  memberUserIds?: string[];
  coworkerIds?: string[];
}

interface UpdateRoomInput {
  name?: string;
  topic?: string | null;
  discoverability?: ChannelDiscoverability;
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
  mentionedUserIds?: string[];
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

function cleanDiscoverability(
  value: ChannelDiscoverability | null | undefined,
): ChannelDiscoverability | undefined {
  if (value === "public" || value === "private") {
    return value;
  }
  return undefined;
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
      discoverability: cleanDiscoverability(input.discoverability) ?? "public",
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

  const shapeError = directCreateShapeError(memberUserIds, coworkerIds);
  if (shapeError) {
    return { ok: false, message: shapeError };
  }

  // Human directs (1:1 or group) need an org (teammate roster). Coworker 1:1
  // uses active org when set; Core stores null only with no active organization.
  if (memberUserIds.length >= 1) {
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
  const shapeError = directCreateShapeError(memberUserIds, coworkerIds);
  if (shapeError) {
    return { ok: false, message: shapeError };
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
      mentionedUserIds: cleanIds(input.mentionedUserIds),
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

export async function updateRoomAction(
  roomId: string,
  input: UpdateRoomInput,
): Promise<RoomActionResult<ChatRoom>> {
  const body = {
    ...(input.name !== undefined && { name: cleanString(input.name) }),
    ...(input.topic !== undefined && { topic: cleanString(input.topic) }),
    ...(input.discoverability !== undefined && {
      discoverability: cleanDiscoverability(input.discoverability),
    }),
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

export async function restoreRoomAction(
  roomId: string,
): Promise<RoomActionResult<ChatRoom>> {
  try {
    const restored = await chatRoomService.restoreRoom(roomId);
    revalidatePath("/chat");
    return { ok: true, data: restored };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not restore channel."),
    };
  }
}

export async function deleteRoomAction(
  roomId: string,
): Promise<RoomActionResult<{ id: string }>> {
  try {
    await chatRoomService.deleteRoom(roomId);
    revalidatePath("/chat");
    return { ok: true, data: { id: roomId } };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not delete channel."),
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

export async function joinRoomAction(
  roomId: string,
): Promise<RoomActionResult<ChatRoom>> {
  const cleanRoomId = cleanString(roomId);
  if (!cleanRoomId) {
    return { ok: false, message: "Channel is required." };
  }

  try {
    const room = await chatRoomService.joinRoom(cleanRoomId);
    revalidatePath("/chat");
    return { ok: true, data: room };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not join channel."),
    };
  }
}

export async function listDiscoverableChannelsAction(options?: {
  q?: string;
}): Promise<RoomActionResult<DiscoverableChatRoom[]>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return { ok: false, message: "Select an organization first." };
  }

  try {
    const rooms = await chatRoomService.listDiscoverableChannels({
      q: options?.q,
    });
    return { ok: true, data: rooms };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not load channels."),
    };
  }
}

export async function sendRoomMessageAction(
  roomId: string,
  content: string,
  mentionedCoworkerIds: string[],
  options?: {
    mentionedUserIds?: string[];
    parentMessageId?: string;
    /** Same-room quote target; does not set parentMessageId. */
    quote?: { messageId: string };
    /**
     * Opaque client turn id. Retries of the same send reuse this so Core
     * creates at most one row (unique on roomId + clientMessageId).
     */
    clientMessageId?: string;
  },
): Promise<RoomActionResult<ChatRoomMessage>> {
  const cleanContent = cleanString(content);
  if (!cleanContent) {
    return { ok: false, message: "Message is required." };
  }

  try {
    const message = await chatRoomService.sendMessage(roomId, {
      content: cleanContent,
      mentionedCoworkerIds: cleanIds(mentionedCoworkerIds),
      mentionedUserIds: cleanIds(options?.mentionedUserIds),
      ...(options?.parentMessageId && {
        parentMessageId: options.parentMessageId,
      }),
      ...(options?.quote?.messageId && {
        quote: { messageId: options.quote.messageId },
      }),
      ...(options?.clientMessageId && {
        clientMessageId: options.clientMessageId,
      }),
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

export async function listThreadAttentionAction(
  roomId: string,
): Promise<RoomActionResult<ChatRoomThreadAttentionItem[]>> {
  try {
    const items = await chatRoomService.listThreadAttention(roomId);
    return { ok: true, data: items };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(
        error,
        "Could not load threads needing attention.",
      ),
    };
  }
}

export async function markThreadReadAction(
  roomId: string,
  parentMessageId: string,
): Promise<RoomActionResult<ChatRoomThreadReadState>> {
  try {
    const state = await chatRoomService.markThreadRead(roomId, parentMessageId);
    return { ok: true, data: state };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not mark thread looked."),
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

export async function deleteRoomMessageAction(
  roomId: string,
  messageId: string,
): Promise<RoomActionResult<ChatRoomMessage>> {
  try {
    const message = await chatRoomService.deleteMessage(roomId, messageId);
    return { ok: true, data: message };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not delete message."),
    };
  }
}

export async function editRoomMessageAction(
  roomId: string,
  messageId: string,
  content: string,
): Promise<RoomActionResult<ChatRoomMessage>> {
  const cleanContent = cleanString(content);
  if (!cleanContent) {
    return { ok: false, message: "Message is required." };
  }

  try {
    const message = await chatRoomService.editMessage(
      roomId,
      messageId,
      cleanContent,
    );
    // No revalidatePath: the updated message is returned and merged client
    // side, so a full RSC re-render of /chat would only duplicate work.
    return { ok: true, data: message };
  } catch (error) {
    return {
      ok: false,
      message: actionErrorMessage(error, "Could not edit message."),
    };
  }
}
