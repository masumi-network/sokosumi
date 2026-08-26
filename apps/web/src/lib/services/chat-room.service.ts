import "server-only";

import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  AcceptChatRoomGuestInviteLink,
  ChannelSlugAvailability,
  ChatRoom,
  ChatRoomGuestInviteLink,
  ChatRoomInvitation,
  ChatRoomKind,
  ChatRoomMessage,
  ChatRoomPinnedMessageListItem,
  ChatRoomPinnedMessageMutation,
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
const THREAD_LIST_PAGE_LIMIT = 50;
/** Membership-visible / archived list page size — Core max, fewer walks. */
const ROOM_LIST_PAGE_LIMIT = 100;
/** Discoverable browse may still walk multiple pages up to Core max page size. */
const DISCOVERABLE_CHANNEL_PAGE_LIMIT = 100;
/** Hard stop so a bad nextCursor cannot loop forever on list walks. */
const ROOM_LIST_MAX_PAGES = 50;

export interface ChatRoomMessagesPage {
  messages: ChatRoomMessage[];
  nextCursor: string | null;
}

export interface ChatRoomsPage {
  rooms: ChatRoom[];
  nextCursor: string | null;
}

export interface ChatRoomThreadsPage {
  threads: ChatRoomThread[];
  nextCursor: string | null;
}

export const chatRoomService = (() => {
  /** Walk Core pages so the sidebar shows the full membership-visible set. */
  const listRooms = cache(async function listRooms(
    kind?: ChatRoomKind,
    status: "active" | "archived" = "active",
  ): Promise<ChatRoomsPage> {
    const rooms: ChatRoom[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < ROOM_LIST_MAX_PAGES; page += 1) {
      const response = await coreClient.getChatRooms({
        limit: ROOM_LIST_PAGE_LIMIT,
        status,
        ...(kind ? { kind } : {}),
        ...(cursor ? { cursor } : {}),
      });
      const nextCursor = response.meta?.pagination?.nextCursor ?? null;
      if (cursor !== undefined && nextCursor === cursor) {
        return { rooms, nextCursor: null };
      }
      rooms.push(...response.data);
      if (!nextCursor) {
        return { rooms, nextCursor: null };
      }
      cursor = nextCursor;
    }

    return { rooms, nextCursor: null };
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

  const listArchivedRooms = cache(
    async function listArchivedRooms(): Promise<ChatRoomsPage> {
      return listRooms("channel", "archived");
    },
  );

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

  async function getChannelSlugAvailability(
    slug: string,
  ): Promise<ChannelSlugAvailability> {
    const response = await coreClient.getChannelSlugAvailability({ slug });
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

  async function listPinnedMessages(
    roomId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{
    items: ChatRoomPinnedMessageListItem[];
    nextCursor: string | null;
  }> {
    const response = await coreClient.getChatRoomPinnedMessages(roomId, {
      cursor: options?.cursor,
      limit: options?.limit,
    });
    return {
      items: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  }

  async function pinMessage(
    roomId: string,
    messageId: string,
  ): Promise<ChatRoomPinnedMessageMutation> {
    const response = await coreClient.pinChatRoomMessage(roomId, messageId);
    return response.data;
  }

  async function unpinMessage(
    roomId: string,
    messageId: string,
  ): Promise<ChatRoomPinnedMessageMutation> {
    const response = await coreClient.unpinChatRoomMessage(roomId, messageId);
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
    options?: { cursor?: string; limit?: number; around?: string },
  ): Promise<ChatRoomMessagesPage> {
    const response = await coreClient.getChatRoomMessages(roomId, {
      limit: options?.limit ?? ROOM_MESSAGE_LIMIT,
      cursor: options?.around ? undefined : options?.cursor,
      around: options?.around,
    });
    return {
      messages: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  });

  const listThreadMessages = cache(async function listThreadMessages(
    roomId: string,
    parentMessageId: string,
    options?: { cursor?: string; limit?: number; around?: string },
  ): Promise<ChatRoomMessagesPage> {
    const response = await coreClient.getChatRoomThreadMessages(
      roomId,
      parentMessageId,
      {
        limit: options?.limit ?? ROOM_MESSAGE_LIMIT,
        cursor: options?.around ? undefined : options?.cursor,
        around: options?.around,
      },
    );
    return {
      messages: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  });

  const getThread = cache(async function getThread(
    roomId: string,
    parentMessageId: string,
  ): Promise<ChatRoomThread | null> {
    try {
      const response = await coreClient.getChatRoomThread(
        roomId,
        parentMessageId,
      );
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  });

  const listThreads = cache(async function listThreads(
    roomId: string,
    options?: { cursor?: string },
  ): Promise<ChatRoomThreadsPage> {
    const response = await coreClient.getChatRoomThreads(roomId, {
      limit: THREAD_LIST_PAGE_LIMIT,
      cursor: options?.cursor,
    });
    return {
      threads: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  });

  const countUnreadThreads = cache(async function countUnreadThreads(
    roomId: string,
  ): Promise<number> {
    const response = await coreClient.getChatRoomThreadsUnreadCount(roomId);
    return response.data.count;
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

  async function retryMention(
    roomId: string,
    messageId: string,
    mentionId: string,
  ): Promise<ChatRoomMessage> {
    const response = await coreClient.retryChatRoomMention(
      roomId,
      messageId,
      mentionId,
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

  async function removeUnfurl(
    roomId: string,
    messageId: string,
    url: string,
  ): Promise<ChatRoomMessage> {
    const response = await coreClient.removeChatRoomMessageUnfurl(
      roomId,
      messageId,
      { url },
    );
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
    getChannelSlugAvailability,
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
    listThreads,
    countUnreadThreads,
    listThreadMessages,
    getThread,
    leaveRoom,
    removeMember,
    markRead,
    markAllUnreadThreadsRead,
    markThreadRead,
    markUnread,
    pinMessage,
    pinRoom,
    listPinnedMessages,
    removeUnfurl,
    resolveRoomGuestInviteLink,
    restoreRoom,
    revokeRoomGuestInviteLink,
    revokeRoomInvitation,
    unpinMessage,
    unpinRoom,
    muteRoom,
    unmuteRoom,
    retryMention,
    sendMessage,
    toggleReaction,
    updateRoom,
  };
})();
