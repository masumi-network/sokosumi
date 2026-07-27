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

export interface ChatRoomMessagesPage {
  messages: ChatRoomMessage[];
  nextCursor: string | null;
}

export const chatRoomService = (() => {
  const listRooms = cache(async function listRooms(
    kind?: ChatRoomKind,
  ): Promise<ChatRoom[]> {
    const response = await coreClient.getChatRooms(kind ? { kind } : undefined);
    return response.data;
  });

  const getRoom = cache(async function getRoom(
    id: string,
  ): Promise<ChatRoom | null> {
    try {
      const response = await coreClient.getChatRoom(id);
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
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
  ): Promise<ChatRoomMessage[]> {
    const response = await coreClient.getChatRoomMessages(roomId, {
      limit: ROOM_MESSAGE_LIMIT,
      parentMessageId,
    });
    return response.data;
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
