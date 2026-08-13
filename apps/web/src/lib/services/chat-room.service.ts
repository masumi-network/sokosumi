import "server-only";

import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  AcceptChatRoomGuestInviteLink,
  ChatRoom,
  ChatRoomGuestInviteLink,
  ChatRoomInvitation,
  ChatRoomKind,
  ChatRoomMessage,
  ChatRoomThread,
  ChatRoomThreadReadState,
  ChatRoomThreadsMarkAll,
  CreateChatRoomGuestInviteLinkRequest,
  CreateChatRoomMessageRequest,
  CreateChatRoomRequest,
  DiscoverableChatRoom,
  ResolveChatRoomGuestInviteLink,
  UpdateChatRoomRequest,
} from "@/lib/clients/generated/core";

const ROOM_MESSAGE_LIMIT = 100;
/** Cold fill / poll / load-more page size — Core default and tasks parity. */
const ROOM_LIST_PAGE_LIMIT = 20;
/** Discoverable browse may still walk multiple pages up to Core max page size. */
const DISCOVERABLE_CHANNEL_PAGE_LIMIT = 100;
/** Hard stop so a bad nextCursor cannot loop forever on discoverable walks. */
const ROOM_LIST_MAX_PAGES = 50;

export interface ChatRoomMessagesPage {
  messages: ChatRoomMessage[];
  nextCursor: string | null;
}

export interface ChatRoomsPage {
  rooms: ChatRoom[];
  nextCursor: string | null;
}

export const chatRoomService = (() => {
  const listRooms = cache(async function listRooms(
    kind?: ChatRoomKind,
    status: "active" | "archived" = "active",
    options?: { cursor?: string },
  ): Promise<ChatRoomsPage> {
    const cursor = options?.cursor;
    const response = await coreClient.getChatRooms({
      limit: ROOM_LIST_PAGE_LIMIT,
      status,
      ...(kind ? { kind } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return {
      rooms: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  });

  async function listDiscoverableChannels(options?: {
    q?: string;
    /** Cap Core pagination walks. Sidebar suggestions use 1 page. */
    maxPages?: number;
  }): Promise<DiscoverableChatRoom[]> {
    const rooms: DiscoverableChatRoom[] = [];
    let cursor: string | undefined;
    const q = options?.q?.trim();
    const maxPages = Math.min(
      Math.max(options?.maxPages ?? ROOM_LIST_MAX_PAGES, 1),
      ROOM_LIST_MAX_PAGES,
    );

    for (let page = 0; page < maxPages; page += 1) {
      const response = await coreClient.getDiscoverableChatRooms({
        limit: DISCOVERABLE_CHANNEL_PAGE_LIMIT,
        ...(q ? { q } : {}),
        ...(cursor ? { cursor } : {}),
      });
      rooms.push(...response.data);
      const nextCursor = response.meta?.pagination?.nextCursor ?? null;
      if (!nextCursor) {
        return rooms;
      }
      cursor = nextCursor;
    }

    return rooms;
  }

  const listArchivedRooms = cache(async function listArchivedRooms(options?: {
    cursor?: string;
  }): Promise<ChatRoomsPage> {
    return listRooms("channel", "archived", options);
  });

  /** Pending room invitations for the signed-in invitee (External sidebar). */
  const listPendingInvitations = cache(
    async function listPendingInvitations(): Promise<ChatRoomInvitation[]> {
      const response = await coreClient.getChatRoomInvitations({
        status: "pending",
      });
      return response.data;
    },
  );

  async function acceptInvitation(id: string): Promise<ChatRoomInvitation> {
    const response = await coreClient.acceptChatRoomInvitation(id);
    return response.data;
  }

  async function declineInvitation(id: string): Promise<ChatRoomInvitation> {
    const response = await coreClient.declineChatRoomInvitation(id);
    return response.data;
  }

  /** Invitee: load one invitation by id (email must match caller). */
  async function getInvitation(id: string): Promise<ChatRoomInvitation | null> {
    try {
      const response = await coreClient.getChatRoomInvitation(id);
      return response.data;
    } catch (error) {
      if (
        error instanceof CoreApiRequestError &&
        (error.status === 404 || error.status === 403)
      ) {
        return null;
      }
      throw error;
    }
  }

  /** Host: pending guest invitations for an external channel. */
  async function listRoomInvitations(
    roomId: string,
  ): Promise<ChatRoomInvitation[]> {
    const response = await coreClient.listChatRoomInvitations(roomId);
    return response.data;
  }

  /** Host: invite external guest by email. */
  async function createRoomInvitation(
    roomId: string,
    email: string,
  ): Promise<ChatRoomInvitation> {
    const response = await coreClient.createChatRoomInvitation(roomId, email);
    return response.data;
  }

  /** Host: revoke a pending guest invitation. */
  async function revokeRoomInvitation(
    roomId: string,
    invitationId: string,
  ): Promise<void> {
    await coreClient.revokeChatRoomInvitation(roomId, invitationId);
  }

  /** Host: list shareable guest invite links for an external channel. */
  async function listRoomGuestInviteLinks(
    roomId: string,
  ): Promise<ChatRoomGuestInviteLink[]> {
    const response = await coreClient.listChatRoomGuestInviteLinks(roomId);
    return response.data;
  }

  /** Host: mint a shareable guest invite link. */
  async function createRoomGuestInviteLink(
    roomId: string,
    body: CreateChatRoomGuestInviteLinkRequest = {},
  ): Promise<ChatRoomGuestInviteLink> {
    const response = await coreClient.createChatRoomGuestInviteLink(
      roomId,
      body,
    );
    return response.data;
  }

  /** Host: revoke a shareable guest invite link. */
  async function revokeRoomGuestInviteLink(
    roomId: string,
    token: string,
  ): Promise<void> {
    await coreClient.revokeChatRoomGuestInviteLink(roomId, token);
  }

  /** Public resolve for `/chat/join/{token}` preview. */
  async function resolveRoomGuestInviteLink(
    token: string,
  ): Promise<ResolveChatRoomGuestInviteLink> {
    const response = await coreClient.resolveChatRoomGuestInviteLink(token);
    return response.data;
  }

  /** Accept shareable guest invite link → access=guest. */
  async function acceptRoomGuestInviteLink(
    token: string,
  ): Promise<AcceptChatRoomGuestInviteLink> {
    const response = await coreClient.acceptChatRoomGuestInviteLink(token);
    return response.data;
  }

  const getRoom = cache(async function getRoom(
    id: string,
  ): Promise<ChatRoom | null> {
    try {
      const response = await coreClient.getChatRoom(id);
      return response.data;
    } catch (error) {
      if (
        error instanceof CoreApiRequestError &&
        // 400: path UUID validation (e.g. /rooms/not-a-real-room-id).
        // 403/404: missing or unauthorized → soft-land on /chat.
        (error.status === 400 || error.status === 403 || error.status === 404)
      ) {
        return null;
      }
      throw error;
    }
  });

  async function createRoom(body: CreateChatRoomRequest): Promise<ChatRoom> {
    const response = await coreClient.createChatRoom(body);
    return response.data;
  }

  async function updateRoom(
    id: string,
    body: UpdateChatRoomRequest,
  ): Promise<ChatRoom> {
    const response = await coreClient.updateChatRoom(id, body);
    return response.data;
  }

  async function archiveRoom(id: string) {
    const response = await coreClient.archiveChatRoom(id);
    return response.data;
  }

  async function restoreRoom(id: string): Promise<ChatRoom> {
    const response = await coreClient.restoreChatRoom(id);
    return response.data;
  }

  async function deleteRoom(id: string): Promise<void> {
    await coreClient.deleteChatRoom(id);
  }

  async function leaveRoom(id: string) {
    const response = await coreClient.leaveChatRoom(id);
    return response.data;
  }

  async function removeMember(roomId: string, userId: string) {
    const response = await coreClient.removeChatRoomMember(roomId, userId);
    return response.data;
  }

  async function joinRoom(id: string): Promise<ChatRoom> {
    const response = await coreClient.joinChatRoom(id);
    return response.data;
  }

  async function markRead(id: string): Promise<ChatRoom> {
    const response = await coreClient.markChatRoomRead(id);
    return response.data;
  }

  async function pinRoom(id: string): Promise<ChatRoom> {
    const response = await coreClient.pinChatRoom(id);
    return response.data;
  }

  async function unpinRoom(id: string): Promise<ChatRoom> {
    const response = await coreClient.unpinChatRoom(id);
    return response.data;
  }

  async function muteRoom(id: string): Promise<ChatRoom> {
    const response = await coreClient.muteChatRoom(id);
    return response.data;
  }

  async function unmuteRoom(id: string): Promise<ChatRoom> {
    const response = await coreClient.unmuteChatRoom(id);
    return response.data;
  }

  async function markUnread(id: string): Promise<ChatRoom> {
    const response = await coreClient.markChatRoomUnread(id);
    return response.data;
  }

  const listMessages = cache(async function listMessages(
    roomId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<ChatRoomMessagesPage> {
    const response = await coreClient.getChatRoomMessages(roomId, {
      limit: options?.limit ?? ROOM_MESSAGE_LIMIT,
      cursor: options?.cursor,
    });
    return {
      messages: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  });

  const listThreadMessages = cache(async function listThreadMessages(
    roomId: string,
    parentMessageId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<ChatRoomMessagesPage> {
    const response = await coreClient.getChatRoomThreadMessages(
      roomId,
      parentMessageId,
      {
        limit: options?.limit ?? ROOM_MESSAGE_LIMIT,
        cursor: options?.cursor,
      },
    );
    return {
      messages: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  });

  const listUnreadThreads = cache(async function listUnreadThreads(
    roomId: string,
  ): Promise<ChatRoomThread[]> {
    const response = await coreClient.getChatRoomThreads(roomId, {
      unread: "true",
    });
    return response.data;
  });

  async function markThreadRead(
    roomId: string,
    parentMessageId: string,
  ): Promise<ChatRoomThreadReadState> {
    const response = await coreClient.markChatRoomThreadRead(
      roomId,
      parentMessageId,
    );
    return response.data;
  }

  async function markAllUnreadThreadsRead(
    roomId: string,
  ): Promise<ChatRoomThreadsMarkAll> {
    const response = await coreClient.markChatRoomThreadsRead(roomId);
    return response.data;
  }

  async function sendMessage(
    roomId: string,
    body: CreateChatRoomMessageRequest,
  ): Promise<ChatRoomMessage> {
    const response = await coreClient.addChatRoomMessage(roomId, body);
    return response.data;
  }

  async function toggleReaction(
    roomId: string,
    messageId: string,
    emoji: string,
  ): Promise<ChatRoomMessage> {
    const response = await coreClient.toggleChatRoomMessageReaction(
      roomId,
      messageId,
      { emoji },
    );
    return response.data;
  }

  async function deleteMessage(
    roomId: string,
    messageId: string,
  ): Promise<ChatRoomMessage> {
    const response = await coreClient.deleteChatRoomMessage(roomId, messageId);
    return response.data;
  }

  async function editMessage(
    roomId: string,
    messageId: string,
    content: string,
  ): Promise<ChatRoomMessage> {
    const response = await coreClient.updateChatRoomMessage(roomId, messageId, {
      content,
    });
    return response.data;
  }

  return {
    acceptInvitation,
    acceptRoomGuestInviteLink,
    archiveRoom,
    createRoom,
    createRoomGuestInviteLink,
    createRoomInvitation,
    declineInvitation,
    deleteMessage,
    deleteRoom,
    editMessage,
    getInvitation,
    getRoom,
    joinRoom,
    listArchivedRooms,
    listDiscoverableChannels,
    listMessages,
    listPendingInvitations,
    listRoomGuestInviteLinks,
    listRoomInvitations,
    listRooms,
    listUnreadThreads,
    listThreadMessages,
    leaveRoom,
    removeMember,
    markRead,
    markAllUnreadThreadsRead,
    markThreadRead,
    markUnread,
    pinRoom,
    resolveRoomGuestInviteLink,
    restoreRoom,
    revokeRoomGuestInviteLink,
    revokeRoomInvitation,
    unpinRoom,
    muteRoom,
    unmuteRoom,
    sendMessage,
    toggleReaction,
    updateRoom,
  };
})();
