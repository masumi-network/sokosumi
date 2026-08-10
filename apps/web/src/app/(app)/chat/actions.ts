"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { actionErrorMessage } from "@/app/chat/action-error-message";
import { directCreateShapeError } from "@/app/chat/utils/direct-create-shape";
import { invalidatePrivateSidebarChrome } from "@/app/components/private-sidebar-cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { getSession } from "@/lib/auth/auth.server";
import type {
  ChatRoom,
  ChatRoomInvitation,
  ChatRoomMessage,
  ChatRoomThread,
  ChatRoomThreadReadState,
  ChatRoomThreadsMarkAll,
  DiscoverableChatRoom,
} from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";

/** Chat action wire shape — ActionResultDto (neverthrow at boundary). */
export type RoomActionResult<T> = ActionResultDto<T, ActionError>;

function roomOk<T>(value: T): RoomActionResult<T> {
  return toActionResult(ok(value));
}

function roomFail(
  message: string,
  code: CommonErrorCode = CommonErrorCode.BAD_INPUT,
): RoomActionResult<never> {
  return toActionResult(err({ code, message }));
}

function roomCatch(error: unknown, fallback: string): RoomActionResult<never> {
  return toActionResult(
    err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: actionErrorMessage(error, fallback),
    }),
  );
}

type ChannelDiscoverability = "public" | "private" | "external";

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
  if (value === "public" || value === "private" || value === "external") {
    return value;
  }
  return undefined;
}

async function invalidateSidebarChatList(): Promise<void> {
  const session = await getSession();
  if (!session) {
    return;
  }
  invalidatePrivateSidebarChrome({
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? null,
  });
}

export async function createChannelAction(
  input: CreateChannelInput,
): Promise<RoomActionResult<ChatRoom>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return roomFail("Select an organization first.");
  }

  const name = cleanString(input.name);
  if (!name) {
    return roomFail("Channel name is required.");
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
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk(room);
  } catch (error) {
    return roomCatch(error, "Could not create channel.");
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
    return roomFail(shapeError);
  }

  // Human directs (1:1 or group) need an org (teammate roster). Coworker 1:1
  // uses active org when set; Core stores null only with no active organization.
  if (memberUserIds.length >= 1) {
    const activeOrganization = await userService.getActiveOrganization();
    if (!activeOrganization) {
      return roomFail("Select an organization first.");
    }
  }

  try {
    const room = await chatRoomService.createRoom({
      kind: "direct",
      memberUserIds,
      coworkerIds,
    });
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk(room);
  } catch (error) {
    return roomCatch(error, "Could not start direct message.");
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
    return roomFail("Coworker is required.");
  }

  try {
    const room = await chatRoomService.createRoom({
      kind: "direct",
      memberUserIds: [],
      coworkerIds: [cleanCoworkerId],
    });
    await invalidateSidebarChatList();
    return roomOk(room);
  } catch (error) {
    return roomCatch(error, "Could not ensure coworker direct room.");
  }
}

export async function sendNewDirectMessageAction(
  input: SendNewDirectMessageInput,
): Promise<RoomActionResult<SendNewDirectMessageResult>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return roomFail("Select an organization first.");
  }

  const memberUserIds = cleanIds(input.memberUserIds);
  const coworkerIds = cleanIds(input.coworkerIds);
  const shapeError = directCreateShapeError(memberUserIds, coworkerIds);
  if (shapeError) {
    return roomFail(shapeError);
  }

  const cleanContent = cleanString(input.content);
  if (!cleanContent) {
    return roomFail("Message is required.");
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
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk({ room, message });
  } catch (error) {
    return roomCatch(error, "Could not start direct message.");
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
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk(room);
  } catch (error) {
    return roomCatch(error, "Could not update channel.");
  }
}

export async function archiveRoomAction(
  roomId: string,
): Promise<RoomActionResult<{ id: string }>> {
  try {
    const archived = await chatRoomService.archiveRoom(roomId);
    // The room disappears from every member's list, so the server-rendered
    // room list has to be rebuilt rather than patched client side.
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk({ id: archived.id });
  } catch (error) {
    return roomCatch(error, "Could not archive channel.");
  }
}

export async function restoreRoomAction(
  roomId: string,
): Promise<RoomActionResult<ChatRoom>> {
  try {
    const restored = await chatRoomService.restoreRoom(roomId);
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk(restored);
  } catch (error) {
    return roomCatch(error, "Could not restore channel.");
  }
}

export async function deleteRoomAction(
  roomId: string,
): Promise<RoomActionResult<{ id: string }>> {
  try {
    await chatRoomService.deleteRoom(roomId);
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk({ id: roomId });
  } catch (error) {
    return roomCatch(error, "Could not delete channel.");
  }
}

export async function leaveRoomAction(
  roomId: string,
): Promise<RoomActionResult<{ id: string }>> {
  try {
    const left = await chatRoomService.leaveRoom(roomId);
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk({ id: left.id });
  } catch (error) {
    return roomCatch(error, "Could not leave channel.");
  }
}

export async function joinRoomAction(
  roomId: string,
): Promise<RoomActionResult<ChatRoom>> {
  const cleanRoomId = cleanString(roomId);
  if (!cleanRoomId) {
    return roomFail("Channel is required.");
  }

  try {
    const room = await chatRoomService.joinRoom(cleanRoomId);
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk(room);
  } catch (error) {
    return roomCatch(error, "Could not join channel.");
  }
}

export async function listDiscoverableChannelsAction(options?: {
  q?: string;
}): Promise<RoomActionResult<DiscoverableChatRoom[]>> {
  const activeOrganization = await userService.getActiveOrganization();
  if (!activeOrganization) {
    return roomFail("Select an organization first.");
  }

  try {
    const rooms = await chatRoomService.listDiscoverableChannels({
      q: options?.q,
    });
    return roomOk(rooms);
  } catch (error) {
    return roomCatch(error, "Could not load channels.");
  }
}

/** Pending room invitations for the signed-in invitee (External sidebar). */
export async function listPendingChatRoomInvitationsAction(): Promise<
  RoomActionResult<ChatRoomInvitation[]>
> {
  try {
    const invitations = await chatRoomService.listPendingInvitations();
    return roomOk(invitations);
  } catch (error) {
    return roomCatch(error, "Could not load invitations.");
  }
}

export async function acceptChatRoomInvitationAction(
  invitationId: string,
): Promise<RoomActionResult<ChatRoomInvitation>> {
  const cleanId = cleanString(invitationId);
  if (!cleanId) {
    return roomFail("Invitation is required.");
  }

  try {
    const invitation = await chatRoomService.acceptInvitation(cleanId);
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk(invitation);
  } catch (error) {
    return roomCatch(error, "Could not accept invitation.");
  }
}

export async function declineChatRoomInvitationAction(
  invitationId: string,
): Promise<RoomActionResult<ChatRoomInvitation>> {
  const cleanId = cleanString(invitationId);
  if (!cleanId) {
    return roomFail("Invitation is required.");
  }

  try {
    const invitation = await chatRoomService.declineInvitation(cleanId);
    await invalidateSidebarChatList();
    revalidatePath("/chat");
    return roomOk(invitation);
  } catch (error) {
    return roomCatch(error, "Could not decline invitation.");
  }
}

/** Host: list pending guest invitations for an external channel. */
export async function listRoomInvitationsAction(
  roomId: string,
): Promise<RoomActionResult<ChatRoomInvitation[]>> {
  const cleanRoomId = cleanString(roomId);
  if (!cleanRoomId) {
    return roomFail("Room is required.");
  }

  try {
    const invitations = await chatRoomService.listRoomInvitations(cleanRoomId);
    return roomOk(invitations);
  } catch (error) {
    return roomCatch(error, "Could not load invitations.");
  }
}

/** Host: invite an external guest by email. */
export async function createRoomInvitationAction(
  roomId: string,
  email: string,
): Promise<RoomActionResult<ChatRoomInvitation>> {
  const cleanRoomId = cleanString(roomId);
  const cleanEmail = cleanString(email).toLowerCase();
  if (!cleanRoomId) {
    return roomFail("Room is required.");
  }
  if (!cleanEmail) {
    return roomFail("Email is required.");
  }

  try {
    const invitation = await chatRoomService.createRoomInvitation(
      cleanRoomId,
      cleanEmail,
    );
    return roomOk(invitation);
  } catch (error) {
    return roomCatch(error, "Could not send invitation.");
  }
}

/** Host: revoke a pending guest invitation. */
export async function revokeRoomInvitationAction(
  roomId: string,
  invitationId: string,
): Promise<RoomActionResult<null>> {
  const cleanRoomId = cleanString(roomId);
  const cleanInvitationId = cleanString(invitationId);
  if (!cleanRoomId) {
    return roomFail("Room is required.");
  }
  if (!cleanInvitationId) {
    return roomFail("Invitation is required.");
  }

  try {
    await chatRoomService.revokeRoomInvitation(cleanRoomId, cleanInvitationId);
    return roomOk(null);
  } catch (error) {
    return roomCatch(error, "Could not revoke invitation.");
  }
}

/** Host: remove a guest from an external channel. */
export async function removeRoomGuestAction(
  roomId: string,
  userId: string,
): Promise<RoomActionResult<null>> {
  const cleanRoomId = cleanString(roomId);
  const cleanUserId = cleanString(userId);
  if (!cleanRoomId) {
    return roomFail("Room is required.");
  }
  if (!cleanUserId) {
    return roomFail("User is required.");
  }

  try {
    await chatRoomService.removeMember(cleanRoomId, cleanUserId);
    return roomOk(null);
  } catch (error) {
    return roomCatch(error, "Could not remove guest.");
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
    return roomFail("Message is required.");
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
    return roomOk(message);
  } catch (error) {
    return roomCatch(error, "Could not send message.");
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
    return roomOk(page);
  } catch (error) {
    return roomCatch(error, "Could not load messages.");
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
    return roomOk(page);
  } catch (error) {
    return roomCatch(error, "Could not load thread.");
  }
}

export async function listUnreadThreadsAction(
  roomId: string,
): Promise<RoomActionResult<ChatRoomThread[]>> {
  try {
    const items = await chatRoomService.listUnreadThreads(roomId);
    return roomOk(items);
  } catch (error) {
    return roomCatch(error, "Could not load unread threads.");
  }
}

export async function markThreadReadAction(
  roomId: string,
  parentMessageId: string,
): Promise<RoomActionResult<ChatRoomThreadReadState>> {
  try {
    const state = await chatRoomService.markThreadRead(roomId, parentMessageId);
    return roomOk(state);
  } catch (error) {
    return roomCatch(error, "Could not mark thread looked.");
  }
}

export async function markAllUnreadThreadsReadAction(
  roomId: string,
): Promise<RoomActionResult<ChatRoomThreadsMarkAll>> {
  try {
    const result = await chatRoomService.markAllUnreadThreadsRead(roomId);
    return roomOk(result);
  } catch (error) {
    return roomCatch(error, "Could not mark unread threads as read.");
  }
}

export async function toggleMessageReactionAction(
  roomId: string,
  messageId: string,
  emoji: string,
): Promise<RoomActionResult<ChatRoomMessage>> {
  const cleanEmoji = cleanString(emoji);
  if (!cleanEmoji) {
    return roomFail("Reaction is required.");
  }

  try {
    const message = await chatRoomService.toggleReaction(
      roomId,
      messageId,
      cleanEmoji,
    );
    // No revalidatePath: the updated message is returned and merged client
    // side, so a full RSC re-render of /chat would only duplicate work.
    return roomOk(message);
  } catch (error) {
    return roomCatch(error, "Could not update reaction.");
  }
}

export async function deleteRoomMessageAction(
  roomId: string,
  messageId: string,
): Promise<RoomActionResult<ChatRoomMessage>> {
  try {
    const message = await chatRoomService.deleteMessage(roomId, messageId);
    return roomOk(message);
  } catch (error) {
    return roomCatch(error, "Could not delete message.");
  }
}

export async function editRoomMessageAction(
  roomId: string,
  messageId: string,
  content: string,
): Promise<RoomActionResult<ChatRoomMessage>> {
  const cleanContent = cleanString(content);
  if (!cleanContent) {
    return roomFail("Message is required.");
  }

  try {
    const message = await chatRoomService.editMessage(
      roomId,
      messageId,
      cleanContent,
    );
    // No revalidatePath: the updated message is returned and merged client
    // side, so a full RSC re-render of /chat would only duplicate work.
    return roomOk(message);
  } catch (error) {
    return roomCatch(error, "Could not edit message.");
  }
}
