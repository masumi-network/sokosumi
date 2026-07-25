import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  ChatChannel,
  ChatChannelMessage,
  CreateChatChannelMessageRequest,
  CreateChatChannelRequest,
  CreateDirectChatChannelRequest,
  UpdateChatChannelRequest,
} from "@/lib/clients/generated/core";

const CHANNEL_MESSAGE_LIMIT = 100;

export const chatChannelService = (() => {
  async function listChannels(organizationId: string): Promise<ChatChannel[]> {
    const response = await coreClient.getChatChannels({ organizationId });
    return response.data;
  }

  async function getChannel(id: string): Promise<ChatChannel | null> {
    try {
      const response = await coreClient.getChatChannel(id);
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async function createChannel(
    body: CreateChatChannelRequest,
  ): Promise<ChatChannel> {
    const response = await coreClient.createChatChannel(body);
    return response.data;
  }

  async function createDirectChannel(
    body: CreateDirectChatChannelRequest,
  ): Promise<ChatChannel> {
    const response = await coreClient.createDirectChatChannel(body);
    return response.data;
  }

  async function updateChannel(
    id: string,
    body: UpdateChatChannelRequest,
  ): Promise<ChatChannel> {
    const response = await coreClient.updateChatChannel(id, body);
    return response.data;
  }

  async function listMessages(
    channelId: string,
  ): Promise<ChatChannelMessage[]> {
    const response = await coreClient.getChatChannelMessages(channelId, {
      limit: CHANNEL_MESSAGE_LIMIT,
    });
    return response.data;
  }

  async function listThreadMessages(
    channelId: string,
    parentMessageId: string,
  ): Promise<ChatChannelMessage[]> {
    const response = await coreClient.getChatChannelMessages(channelId, {
      limit: CHANNEL_MESSAGE_LIMIT,
      parentMessageId,
    });
    return response.data;
  }

  async function sendMessage(
    channelId: string,
    body: CreateChatChannelMessageRequest,
  ): Promise<ChatChannelMessage> {
    const response = await coreClient.addChatChannelMessage(channelId, body);
    return response.data;
  }

  async function toggleReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<ChatChannelMessage> {
    const response = await coreClient.toggleChatChannelMessageReaction(
      channelId,
      messageId,
      { emoji },
    );
    return response.data;
  }

  return {
    createChannel,
    createDirectChannel,
    getChannel,
    listChannels,
    listMessages,
    listThreadMessages,
    sendMessage,
    toggleReaction,
    updateChannel,
  };
})();
