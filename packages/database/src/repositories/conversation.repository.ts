import type { Conversation, Prisma } from "../generated/prisma/client.js";

/**
 * Repository for conversation-related database operations.
 * Provides methods to manage internal conversation IDs with strict user-scoped access.
 * Note: The "openaiId" field stores internal UUIDs (kept for schema compatibility).
 */
export const conversationRepository = {
  /**
   * Creates a new conversation mapping.
   *
   * @param data - Conversation data including internal conversation ID and user ID
   * @param tx - Prisma transaction client
   * @returns Created conversation
   */
  createConversation: async (
    data: {
      openaiId: string;
      userId: string;
      title?: string;
      metadata?: Record<string, unknown>;
    },
    tx: Prisma.TransactionClient,
  ): Promise<Conversation> => {
    return tx.conversation.create({ data });
  },

  /**
   * Retrieves a conversation by internal database ID.
   * CRITICAL: Always filters by userId for security.
   * Only returns non-deleted conversations by default.
   *
   * @param id - Internal database ID
   * @param userId - User ID for ownership validation
   * @param tx - Prisma transaction client
   * @param includeDeleted - If true, includes deleted conversations (for recovery purposes)
   * @returns Conversation if found and owned by user, null otherwise
   */
  getConversationById: async (
    id: string,
    userId: string,
    tx: Prisma.TransactionClient,
    includeDeleted = false,
  ): Promise<Conversation | null> => {
    return tx.conversation.findFirst({
      where: {
        id,
        userId, // CRITICAL: Always filter by userId
        ...(includeDeleted ? {} : { deletedAt: null }), // Exclude deleted unless explicitly requested
      },
    });
  },

  /**
   * Retrieves a conversation by internal conversation ID (stored in openaiId field).
   * CRITICAL: This is ONLY used internally after ownership validation.
   * Internal conversation IDs are never exposed in API responses.
   * Only returns non-deleted conversations by default.
   *
   * @param openaiId - Internal conversation ID (stored in openaiId field for schema compatibility)
   * @param userId - User ID for ownership validation
   * @param tx - Prisma transaction client
   * @param includeDeleted - If true, includes deleted conversations (for recovery purposes)
   * @returns Conversation if found and owned by user, null otherwise
   */
  getConversationByOpenaiId: async (
    openaiId: string,
    userId: string,
    tx: Prisma.TransactionClient,
    includeDeleted = false,
  ): Promise<Conversation | null> => {
    return tx.conversation.findFirst({
      where: {
        openaiId,
        userId, // CRITICAL: Always filter by userId
        ...(includeDeleted ? {} : { deletedAt: null }), // Exclude deleted unless explicitly requested
      },
    });
  },

  /**
   * Lists all conversations for a specific user.
   * CRITICAL: Only returns conversations owned by the specified user.
   * Only returns non-deleted conversations by default.
   *
   * @param userId - User ID
   * @param tx - Prisma transaction client
   * @param options - Optional pagination and ordering options
   * @param includeDeleted - If true, includes deleted conversations (for recovery purposes)
   * @returns Array of user's conversations
   */
  getUserConversations: async (
    userId: string,
    tx: Prisma.TransactionClient,
    options?: { limit?: number; orderBy?: "asc" | "desc" },
    includeDeleted = false,
  ): Promise<Conversation[]> => {
    return tx.conversation.findMany({
      where: {
        userId, // CRITICAL: Only return user's conversations
        ...(includeDeleted ? {} : { deletedAt: null }), // Exclude deleted unless explicitly requested
      },
      orderBy: { updatedAt: options?.orderBy || "desc" },
      take: options?.limit,
    });
  },

  /**
   * Updates a conversation's metadata.
   * CRITICAL: Validates ownership before updating.
   *
   * @param id - Internal database ID
   * @param userId - User ID for ownership validation
   * @param data - Update data
   * @param tx - Prisma transaction client
   * @returns Updated conversation
   * @throws Error if conversation not found or access denied
   */
  updateConversation: async (
    id: string,
    userId: string,
    data: { title?: string; metadata?: Record<string, unknown> },
    tx: Prisma.TransactionClient,
  ): Promise<Conversation> => {
    // First verify ownership (exclude deleted conversations)
    const existing = await tx.conversation.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!existing) {
      throw new Error("Conversation not found or access denied");
    }

    return tx.conversation.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  },

  /**
   * Soft deletes a conversation mapping by setting deletedAt timestamp.
   * CRITICAL: Validates ownership before soft deleting.
   * The conversation can be recovered by setting deletedAt to null.
   *
   * @param id - Internal database ID
   * @param userId - User ID for ownership validation
   * @param tx - Prisma transaction client
   * @throws Error if conversation not found or access denied
   */
  deleteConversation: async (
    id: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> => {
    // First verify ownership (include deleted conversations for recovery)
    const existing = await tx.conversation.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new Error("Conversation not found or access denied");
    }

    // CRITICAL: Soft delete by setting deletedAt timestamp
    // DO NOT use tx.conversation.delete() - this would permanently delete the record
    // This method MUST use update() to set deletedAt for soft deletion
    await tx.conversation.update({
      where: { id },
      data: { deletedAt: new Date(), updatedAt: new Date() },
    });
  },
};
