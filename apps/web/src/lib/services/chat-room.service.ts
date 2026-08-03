import "server-only";

import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  BrowsableChatRoom,
  ChatRoom,
  ChatRoomKind,
  ChatRoomMessage,
  CreateChatRoomMessageRequest,
  CreateChatRoomRequest,
  UpdateChatRoomRequest,
} from "@/lib/clients/generated/core";

const ROOM_MESSAGE_LIMIT = 100;
/** Matches Core `LIMITS.MAX_PAGINATION_LIMIT` for room list pages. */
const ROOM_LIST_PAGE_LIMIT = 100;
/** Hard stop so a bad nextCursor cannot loop forever. */
const ROOM_LIST_MAX_PAGES = 50;

export interface ChatRoomMessagesPage {
  messages: ChatRoomMessage[];
  nextCursor: string | null;
}

export const chatRoomService = (() => {
  const listRooms = cache(async function listRooms(
    kind?: ChatRoomKind,
    status: "active" | "archived" = "active",
  ): Promise<ChatRoom[]> {
    const rooms: ChatRoom[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < ROOM_LIST_MAX_PAGES; page += 1) {
      const response = await coreClient.getChatRooms({
        limit: ROOM_LIST_PAGE_LIMIT,
        status,
        ...(kind ? { kind } : {}),
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
  });

  async function listBrowsableChannels(options?: {
    q?: string;
    /** Cap Core pagination walks. Sidebar suggestions use 1 page. */
    maxPages?: number;
  }): Promise<BrowsableChatRoom[]> {
    const rooms: BrowsableChatRoom[] = [];
    let cursor: string | undefined;
    const q = options?.q?.trim();
    const maxPages = Math.min(
      Math.max(options?.maxPages ?? ROOM_LIST_MAX_PAGES, 1),
      ROOM_LIST_MAX_PAGES,
    );

    for (let page = 0; page < maxPages; page += 1) {
      const response = await coreClient.getBrowsableChatRooms({
        limit: ROOM_LIST_PAGE_LIMIT,
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

  const listArchivedRooms = cache(async function listArchivedRooms(): Promise<
    ChatRoom[]
  > {
    return listRooms("channel", "archived");
  });

  const getRoom = cache(async function getRoom(
    id: string,
  ): Promise<ChatRoom | null> {
    try {
      const response = await coreClient.getChatRoom(id);
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

  async function leaveRoom(id: string) {
    const response = await coreClient.leaveChatRoom(id);
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
    const response = await coreClient.getChatRoomMessages(roomId, {
      limit: options?.limit ?? ROOM_MESSAGE_LIMIT,
      parentMessageId,
      cursor: options?.cursor,
    });
    return {
      messages: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  });

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
    archiveRoom,
    createRoom,
    deleteMessage,
    editMessage,
    getRoom,
    joinRoom,
    listArchivedRooms,
    listBrowsableChannels,
    listMessages,
    listRooms,
    listThreadMessages,
    leaveRoom,
    markRead,
    markUnread,
    pinRoom,
    restoreRoom,
    unpinRoom,
    sendMessage,
    toggleReaction,
    updateRoom,
  };
})();
