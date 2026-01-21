"use server";

import { conversationRepository } from "@sokosumi/database/repositories";
import { randomUUID } from "crypto";
import { Result } from "neverthrow";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import prisma from "@/lib/db/prisma";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

interface CreateConversationParameters extends AuthenticatedRequest {
  conversationId?: string; // Optional - will generate UUID if not provided
  metadata?: Record<string, unknown>;
  title?: string;
}

interface UpdateConversationParameters extends AuthenticatedRequest {
  id: string; // Internal database ID
  metadata?: Record<string, unknown>;
  title?: string;
}

interface GetConversationParameters extends AuthenticatedRequest {
  id: string; // Internal database ID
}

interface ListConversationsParameters extends AuthenticatedRequest {
  limit?: number;
  order?: "asc" | "desc";
}

export interface ConversationItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: Array<{ type: string; text?: string }> | string;
  status: string;
  created_at: number;
}

export interface Conversation {
  id: string; // Internal database ID
  userId: string;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationWithItems extends Conversation {
  items?: ConversationItem[];
}

/**
 * Creates a new conversation and stores it in the database.
 * Uses OpenRouter for chat functionality (no OpenAI API required).
 * If conversationId is provided, uses it; otherwise generates a UUID.
 */
export const createConversation = withAuthContext<
  CreateConversationParameters,
  Result<Conversation, ActionError>
>(async ({ conversationId, metadata, title, authContext }) => {
  const { userId } = authContext;

  try {
    // Generate conversation ID if not provided
    // Format: conv_<uuid> to maintain compatibility with existing database schema
    const finalConversationId =
      conversationId || `conv_${randomUUID().replace(/-/g, "")}`;

    // Check if conversation already exists in our database
    const existing = await conversationRepository.getConversationByOpenaiId(
      finalConversationId,
      userId,
      prisma,
    );

    if (existing) {
      return {
        ok: true,
        data: {
          id: existing.id,
          userId: existing.userId,
          title: existing.title,
          metadata: existing.metadata as Record<string, unknown> | null,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        },
      } as unknown as Result<Conversation, ActionError>;
    }

    // Create database mapping
    const conversation = await conversationRepository.createConversation(
      {
        openaiId: finalConversationId, // Stored as openaiId for schema compatibility, but it's our own UUID
        userId,
        title: title || `Conversation ${new Date().toLocaleString()}`,
        metadata: { ...metadata, user_id: userId },
      },
      prisma,
    );

    return {
      ok: true,
      data: {
        id: conversation.id,
        userId: conversation.userId,
        title: conversation.title,
        metadata: conversation.metadata as Record<string, unknown> | null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    } as unknown as Result<Conversation, ActionError>;
  } catch (error) {
    return {
      ok: false,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Failed to create conversation",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      },
    } as unknown as Result<Conversation, ActionError>;
  }
});

/**
 * Updates a conversation's metadata in the database.
 * CRITICAL: Validates ownership before updating.
 */
export const updateConversation = withAuthContext<
  UpdateConversationParameters,
  Result<Conversation, ActionError>
>(async ({ id, metadata, title, authContext }) => {
  const { userId } = authContext;

  try {
    // CRITICAL: Validate ownership before update
    const conversation = await conversationRepository.getConversationById(
      id,
      userId,
      prisma,
    );

    if (!conversation) {
      return {
        ok: false,
        error: {
          message: "Conversation not found",
          code: CommonErrorCode.BAD_INPUT,
        },
      } as unknown as Result<Conversation, ActionError>;
    }

    const updated = await conversationRepository.updateConversation(
      id,
      userId,
      {
        title,
        metadata,
      },
      prisma,
    );

    return {
      ok: true,
      data: {
        id: updated.id,
        userId: updated.userId,
        title: updated.title,
        metadata: updated.metadata as Record<string, unknown> | null,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    } as unknown as Result<Conversation, ActionError>;
  } catch (error) {
    return {
      ok: false,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Failed to update conversation",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      },
    } as unknown as Result<Conversation, ActionError>;
  }
});

/**
 * Gets a conversation by internal database ID.
 * CRITICAL: Validates ownership before returning.
 * Optionally fetches items from OpenAI API if needed.
 */
export const getConversation = withAuthContext<
  GetConversationParameters,
  Result<ConversationWithItems, ActionError>
>(async ({ id, authContext }) => {
  const { userId } = authContext;

  try {
    // CRITICAL: Validate ownership before returning
    const conversation = await conversationRepository.getConversationById(
      id,
      userId,
      prisma,
    );

    if (!conversation) {
      return {
        ok: false,
        error: {
          message: "Conversation not found",
          code: CommonErrorCode.BAD_INPUT,
        },
      } as unknown as Result<ConversationWithItems, ActionError>;
    }

    // Optionally fetch items from OpenAI if needed
    // For now, return conversation without items
    // Items can be fetched separately via OpenAI API after ownership validation

    return {
      ok: true,
      data: {
        id: conversation.id,
        userId: conversation.userId,
        title: conversation.title,
        metadata: conversation.metadata as Record<string, unknown> | null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        items: undefined, // Can be populated separately if needed
      },
    } as unknown as Result<ConversationWithItems, ActionError>;
  } catch (error) {
    return {
      ok: false,
      error: {
        message:
          error instanceof Error ? error.message : "Failed to get conversation",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      },
    } as unknown as Result<ConversationWithItems, ActionError>;
  }
});

/**
 * Lists conversations for the current user from the database.
 * CRITICAL: Only returns conversations owned by the authenticated user.
 */
export const listConversations = withAuthContext<
  ListConversationsParameters,
  Result<Conversation[], ActionError>
>(async ({ limit = 50, order = "desc", authContext }) => {
  const { userId } = authContext;

  try {
    const conversations = await conversationRepository.getUserConversations(
      userId,
      prisma,
      {
        limit,
        orderBy: order,
      },
    );

    return {
      ok: true,
      data: conversations.map((conv) => ({
        id: conv.id,
        userId: conv.userId,
        title: conv.title,
        metadata: conv.metadata as Record<string, unknown> | null,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      })),
    } as unknown as Result<Conversation[], ActionError>;
  } catch (error) {
    return {
      ok: false,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Failed to list conversations",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      },
    } as unknown as Result<Conversation[], ActionError>;
  }
});

/**
 * Deletes a conversation mapping from the database.
 * CRITICAL: Validates ownership before deleting.
 * Note: OpenAI conversation deletion should be handled separately if needed.
 */
export const deleteConversation = withAuthContext<
  GetConversationParameters,
  Result<{ success: boolean }, ActionError>
>(async ({ id, authContext }) => {
  const { userId } = authContext;

  try {
    // CRITICAL: Validate ownership before delete
    // Include deleted conversations so we can re-delete already soft-deleted ones
    const conversation = await conversationRepository.getConversationById(
      id,
      userId,
      prisma,
      true, // includeDeleted = true to allow re-deleting already soft-deleted conversations
    );

    if (!conversation) {
      return {
        ok: false,
        error: {
          message: "Conversation not found",
          code: CommonErrorCode.BAD_INPUT,
        },
      } as unknown as Result<{ success: boolean }, ActionError>;
    }

    // Soft delete from database (sets deletedAt timestamp)
    // This will set deletedAt even if it's already set (idempotent operation)
    await conversationRepository.deleteConversation(id, userId, prisma);

    return {
      ok: true,
      data: { success: true },
    } as unknown as Result<{ success: boolean }, ActionError>;
  } catch (error) {
    return {
      ok: false,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Failed to delete conversation",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      },
    } as unknown as Result<{ success: boolean }, ActionError>;
  }
});

/**
 * Validates that a conversation exists and belongs to the user.
 * CRITICAL: Validates ownership before returning.
 * This is used internally by API routes to validate conversation access.
 * Note: The "openaiId" field in the database is now just an internal conversation ID (not from OpenAI).
 */
export const getOpenaiConversationId = withAuthContext<
  GetConversationParameters,
  Result<{ openaiId: string }, ActionError>
>(async ({ id, authContext }) => {
  const { userId } = authContext;

  try {
    // CRITICAL: Validate ownership before returning conversation ID
    const conversation = await conversationRepository.getConversationById(
      id,
      userId,
      prisma,
    );

    if (!conversation) {
      return {
        ok: false,
        error: {
          message: "Conversation not found or unauthorized",
          code: CommonErrorCode.BAD_INPUT,
        },
      } as unknown as Result<{ openaiId: string }, ActionError>;
    }

    return {
      ok: true,
      data: { openaiId: conversation.openaiId },
    } as unknown as Result<{ openaiId: string }, ActionError>;
  } catch (error) {
    return {
      ok: false,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Failed to validate conversation",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      },
    } as unknown as Result<{ openaiId: string }, ActionError>;
  }
});
