import type { ConversationItem, Prisma } from "../generated/prisma/client.js";

/**
 * Repository for conversation item-related database operations.
 * Provides methods to manage conversation messages/items with strict user-scoped access.
 */
export const conversationItemRepository = {
  /**
   * Creates a new conversation item (message).
   *
   * @param data - Conversation item data including conversation ID, role, and content
   * @param tx - Prisma transaction client
   * @returns Created conversation item
   */
  createItem: async (
    data: {
      conversationId: string;
      role: "user" | "assistant" | "system";
      content: string | Array<{ type: string; text?: string }>;
    },
    tx: Prisma.TransactionClient,
  ): Promise<ConversationItem> => {
    return tx.conversationItem.create({
      data: {
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
      },
    });
  },

  /**
   * Retrieves all items for a conversation, ordered by creation time.
   * CRITICAL: This should only be called after validating conversation ownership.
   *
   * @param conversationId - Conversation ID
   * @param tx - Prisma transaction client
   * @param options - Optional pagination options
   * @returns Array of conversation items ordered by createdAt (ascending)
   */
  getItemsByConversationId: async (
    conversationId: string,
    tx: Prisma.TransactionClient,
    options?: { limit?: number; after?: string },
  ): Promise<ConversationItem[]> => {
    return tx.conversationItem.findMany({
      where: {
        conversationId,
      },
      orderBy: { createdAt: "asc" },
      ...(options?.after
        ? {
            cursor: { id: options.after },
            skip: 1,
          }
        : {}),
      ...(options?.limit ? { take: options.limit } : {}),
    });
  },

  /**
   * Retrieves a conversation item by ID.
   *
   * @param id - Item ID
   * @param tx - Prisma transaction client
   * @returns Conversation item if found, null otherwise
   */
  getItemById: async (
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<ConversationItem | null> => {
    return tx.conversationItem.findUnique({
      where: { id },
    });
  },

  /**
   * Deletes a conversation item by ID.
   * CRITICAL: This should only be called after validating conversation ownership.
   *
   * @param id - Item ID
   * @param tx - Prisma transaction client
   */
  deleteItem: async (
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> => {
    await tx.conversationItem.delete({
      where: { id },
    });
  },

  /**
   * Deletes all items for a conversation.
   * CRITICAL: This should only be called after validating conversation ownership.
   *
   * @param conversationId - Conversation ID
   * @param tx - Prisma transaction client
   */
  deleteItemsByConversationId: async (
    conversationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> => {
    await tx.conversationItem.deleteMany({
      where: { conversationId },
    });
  },
};
