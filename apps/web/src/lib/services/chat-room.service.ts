import "server-only";

import { cache } from "react";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
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
  ): Promise<ChatRoom[]> {
    const rooms: ChatRoom[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < ROOM_LIST_MAX_PAGES; page += 1) {
      const response = await coreClient.getChatRooms({
        limit: ROOM_LIST_PAGE_LIMIT,
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

  async function markRead(id: string): Promise<ChatRoom> {
    const response = await coreClient.markChatRoomRead(id);
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

  return {
    createRoom,
    getRoom,
    listMessages,
    listRooms,
    listThreadMessages,
    markRead,
    sendMessage,
    toggleReaction,
    updateRoom,
  };
})();
