import type {
  ChatCatchUpSummary,
  ChatRoomCatchUp,
  ChatRoomMessage,
  ChatSignalListItem,
  ChatSignalRoutingSuggestion,
  ChatSignalTag,
} from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

/**
 * Chat signals: what Jev read in chat messages and the views Core builds on
 * it. Every read is the viewer's own and is never cached across requests.
 */
export const chatSignalsService = {
  async getSummary(roomId?: string): Promise<ChatCatchUpSummary> {
    return (await coreClient.getChatCatchUpSummary(roomId)).data;
  },

  async getRoomCatchUp(roomId: string): Promise<ChatRoomCatchUp> {
    return (await coreClient.getChatRoomCatchUp(roomId)).data;
  },

  async listNeedsYou(): Promise<ChatSignalListItem[]> {
    return (await coreClient.getChatNeedsYou()).data;
  },

  async listOpenLoops(): Promise<ChatSignalListItem[]> {
    return (await coreClient.getChatOpenLoops()).data;
  },

  async listDecisions(
    roomId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ messages: ChatRoomMessage[]; nextCursor: string | null }> {
    const response = await coreClient.getChatRoomDecisions(roomId, options);
    return {
      messages: response.data,
      nextCursor: response.meta?.pagination?.nextCursor ?? null,
    };
  },

  async correctTag(
    messageId: string,
    tag: ChatSignalTag,
    applies: boolean,
  ): Promise<ChatRoomMessage> {
    return (
      await coreClient.correctChatMessageSignal(messageId, { tag, applies })
    ).data;
  },

  async setLoop(
    messageId: string,
    loop: { closed: boolean; taskId?: string | null },
  ): Promise<ChatRoomMessage> {
    return (await coreClient.setChatMessageSignalLoop(messageId, loop)).data;
  },

  async suggestCoworkers(
    messageId: string,
  ): Promise<ChatSignalRoutingSuggestion[]> {
    return (await coreClient.getChatMessageRoutingSuggestions(messageId)).data;
  },
};
