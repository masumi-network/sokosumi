"use server";

import { err, ok, type Result } from "neverthrow";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  type CoreApiPagination,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type {
  ConversationMessage,
  Conversation as CoreConversation,
  CreateConversationMessageRequest,
} from "@/lib/clients/generated/core/types.gen";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

/** Conversation shape returned by server actions (dates serialized as ISO strings). */
export type Conversation = Omit<CoreConversation, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

/** Conversation with optional loaded messages (e.g. from getConversation). */
export interface ConversationWithMessages extends Conversation {
  messages?: ConversationMessage[];
}

interface CreateConversationParameters extends AuthenticatedRequest {
  conversationId?: string; // Optional conversation ID
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

interface AddConversationMessageParameters
  extends AuthenticatedRequest,
    CreateConversationMessageRequest {
  conversationId: string; // Internal database ID
}

interface GetConversationMessagesParameters extends AuthenticatedRequest {
  conversationId: string; // Internal database ID
  limit?: number;
  cursor?: string | null;
}

interface GetConversationWarmupParameters extends AuthenticatedRequest {
  conversationId: string;
}

export type ConversationWarmupData = {
  state: "pending" | "ready" | "failed";
  completedAt: string | null;
  attempts?: number | null;
  source: "redis" | "metadata" | "none";
};

/** API response may have optional title/metadata; we normalize to Conversation. */
function toConversation(conversation: CoreConversation): Conversation {
  return {
    ...conversation,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

async function makeCoreApiRequest<T>(
  request: () => Promise<T>,
): Promise<Result<T, ActionError>> {
  try {
    return ok(await request());
  } catch (error) {
    return err(toCoreApiActionError(error));
  }
}

/**
 * Lists conversations for the current user via Core API
 * CRITICAL: Only returns conversations owned by the authenticated user.
 */
export const listConversations = withSession<
  ListConversationsParameters,
  Result<Conversation[], ActionError>
>(async () => {
  const result = await makeCoreApiRequest(() => coreClient.getConversations());

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<Conversation[], ActionError>;
  }

  const conversations = (result.value.data ?? []).map((conversation) =>
    toConversation(conversation),
  );

  return {
    ok: true,
    data: conversations,
  } as unknown as Result<Conversation[], ActionError>;
});

/**
 * Gets conversation messages by conversation ID via Core API
 * CRITICAL: Validates ownership before returning.
 * Returns messages and pagination metadata for cursor-based pagination.
 */
export const getConversationMessages = withSession<
  GetConversationMessagesParameters,
  Result<
    {
      messages: ConversationMessage[];
      pagination: CoreApiPagination | null;
    },
    ActionError
  >
>(async ({ conversationId, limit, cursor }) => {
  const result = await makeCoreApiRequest(() =>
    coreClient.getConversationMessages(conversationId, {
      limit,
      cursor: cursor ?? undefined,
    }),
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<
      {
        messages: ConversationMessage[];
        pagination: CoreApiPagination | null;
      },
      ActionError
    >;
  }

  return {
    ok: true,
    data: {
      messages: (result.value.data ?? []) as ConversationMessage[],
      pagination: result.value.meta?.pagination ?? null,
    },
  } as unknown as Result<
    {
      messages: ConversationMessage[];
      pagination: CoreApiPagination | null;
    },
    ActionError
  >;
});

/**
 * Gets coworker container warmup state for a conversation via Core API.
 * CRITICAL: Validates ownership before returning.
 */
export const getConversationWarmup = withSession<
  GetConversationWarmupParameters,
  Result<ConversationWarmupData, ActionError>
>(async ({ conversationId }) => {
  const result = await makeCoreApiRequest(() =>
    coreClient.getConversationWarmup(conversationId),
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<ConversationWarmupData, ActionError>;
  }

  const data = result.value.data;
  return {
    ok: true,
    data: {
      state: data.state,
      completedAt: data.completedAt?.toISOString() ?? null,
      attempts: data.attempts,
      source: data.source,
    },
  } as unknown as Result<ConversationWarmupData, ActionError>;
});

/**
 * Gets a conversation by internal database ID via Core API
 * CRITICAL: Validates ownership before returning.
 * Fetches conversation messages from the database.
 */
export const getConversation = withSession<
  GetConversationParameters,
  Result<ConversationWithMessages, ActionError>
>(async ({ id }) => {
  // Fetch conversation metadata
  const conversationResult = await makeCoreApiRequest(() =>
    coreClient.getConversation(id),
  );

  if (conversationResult.isErr()) {
    return {
      ok: false,
      error: conversationResult.error,
    } as unknown as Result<ConversationWithMessages, ActionError>;
  }

  // Fetch conversation messages from database (limit 100 so list/conversation view has full history)
  const messagesResult = await getConversationMessages({
    conversationId: id,
    limit: 100,
  });

  // Handle serialized Result format from getConversationMessages
  if (
    messagesResult &&
    typeof messagesResult === "object" &&
    "ok" in messagesResult &&
    messagesResult.ok === false
  ) {
    // If message fetch fails, return conversation without messages
    return {
      ok: true,
      data: {
        ...toConversation(conversationResult.value.data),
        messages: [],
      },
    } as unknown as Result<ConversationWithMessages, ActionError>;
  }

  // Extract messages from serialized Result format
  const messages =
    messagesResult &&
    typeof messagesResult === "object" &&
    "ok" in messagesResult &&
    messagesResult.ok === true &&
    "data" in messagesResult &&
    messagesResult.data &&
    typeof messagesResult.data === "object" &&
    "messages" in messagesResult.data
      ? (messagesResult.data.messages as ConversationMessage[])
      : [];

  return {
    ok: true,
    data: {
      ...toConversation(conversationResult.value.data),
      messages,
    },
  } as unknown as Result<ConversationWithMessages, ActionError>;
});

/**
 * Creates a new conversation via Core API
 */
export const createConversation = withSession<
  CreateConversationParameters,
  Result<Conversation, ActionError>
>(async ({ conversationId, metadata, title }) => {
  const requestBody = {
    openaiId: conversationId,
    title,
    metadata,
  };
  const result = await makeCoreApiRequest(() =>
    coreClient.createConversation(requestBody),
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<Conversation, ActionError>;
  }

  return {
    ok: true,
    data: toConversation(result.value.data),
  } as unknown as Result<Conversation, ActionError>;
});

/**
 * Updates a conversation via Core API
 * CRITICAL: Validates ownership before updating.
 */
export const updateConversation = withSession<
  UpdateConversationParameters,
  Result<Conversation, ActionError>
>(async ({ id, metadata, title }) => {
  const result = await makeCoreApiRequest(() =>
    coreClient.updateConversation(id, {
      title,
      metadata,
    }),
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<Conversation, ActionError>;
  }

  return {
    ok: true,
    data: toConversation(result.value.data),
  } as unknown as Result<Conversation, ActionError>;
});

/**
 * Archives a conversation via Core API
 * CRITICAL: Validates ownership before archiving.
 */
export const deleteConversation = withSession<
  GetConversationParameters,
  Result<Conversation, ActionError>
>(async ({ id }) => {
  const result = await makeCoreApiRequest(() =>
    coreClient.archiveConversation(id, true),
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<Conversation, ActionError>;
  }

  return {
    ok: true,
    data: toConversation(result.value.data),
  } as unknown as Result<Conversation, ActionError>;
});

/**
 * Validates that a conversation exists and belongs to the user via Core API
 * CRITICAL: Validates ownership before returning.
 * Returns the internal conversation ID for use with API endpoints.
 */
export const getConversationId = withSession<
  GetConversationParameters,
  Result<{ conversationId: string }, ActionError>
>(async ({ id }) => {
  // Validate ownership by getting the conversation
  const result = await makeCoreApiRequest(() => coreClient.getConversation(id));

  if (result.isErr()) {
    return err({
      message: "Conversation not found or unauthorized",
      code: CommonErrorCode.BAD_INPUT,
    } as ActionError);
  }

  // Return the internal conversation ID
  return ok({ conversationId: id });
});

/**
 * Adds a message to a conversation via Core API
 * Used by chat route to store messages in conversations
 */
export const addConversationMessage = withSession<
  AddConversationMessageParameters,
  Result<{ id: string }, ActionError>
>(async ({ conversationId, role, content }) => {
  const result = await makeCoreApiRequest(() =>
    coreClient.addConversationMessage(conversationId, {
      role,
      content,
    }),
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<{ id: string }, ActionError>;
  }

  const item = result.value.data as ConversationMessage | undefined;
  if (!item?.id) {
    return {
      ok: false,
      error: {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Failed to add conversation message",
      },
    } as unknown as Result<{ id: string }, ActionError>;
  }

  return {
    ok: true,
    data: { id: item.id },
  } as unknown as Result<{ id: string }, ActionError>;
});
