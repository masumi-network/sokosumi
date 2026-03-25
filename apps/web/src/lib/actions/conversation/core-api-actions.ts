"use server";

import { err, ok, type Result } from "neverthrow";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  type CoreApiPagination,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import type {
  Conversation as CoreConversation,
  ConversationItem,
} from "@/lib/clients/generated/core/types.gen";
import {
  AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

/** Conversation shape returned by server actions (dates serialized as ISO strings). */
export type Conversation = Omit<CoreConversation, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

/** Conversation with optional items (e.g. from getConversation). */
export interface ConversationWithItems extends Conversation {
  items?: ConversationItem[];
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

interface AddConversationItemParameters extends AuthenticatedRequest {
  conversationId: string; // Internal database ID
  role: "user" | "assistant" | "system";
  content: Array<{ type: string; text?: string }> | string;
}

interface GetConversationItemsParameters extends AuthenticatedRequest {
  conversationId: string; // Internal database ID
  limit?: number;
  cursor?: string | null;
}

interface RecoverConversationResponseParameters extends AuthenticatedRequest {
  conversationId: string; // Internal database ID
}

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
 * Gets conversation items (messages) by conversation ID via Core API
 * CRITICAL: Validates ownership before returning.
 * Returns items and pagination metadata for cursor-based pagination.
 */
export const getConversationItems = withSession<
  GetConversationItemsParameters,
  Result<
    { items: ConversationItem[]; pagination: CoreApiPagination | null },
    ActionError
  >
>(async ({ conversationId, limit, cursor }) => {
  const result = await makeCoreApiRequest(() =>
    coreClient.getConversationItems(conversationId, {
      limit,
      cursor: cursor ?? undefined,
    }),
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<
      { items: ConversationItem[]; pagination: CoreApiPagination | null },
      ActionError
    >;
  }

  return {
    ok: true,
    data: {
      items: (result.value.data ?? []) as ConversationItem[],
      pagination: result.value.meta?.pagination ?? null,
    },
  } as unknown as Result<
    { items: ConversationItem[]; pagination: CoreApiPagination | null },
    ActionError
  >;
});

/**
 * Recovers a pending coworker response after client disconnect via Core API.
 * Returns { recovered: true } if a response was persisted, { recovered: false, reason? } otherwise.
 * reason is "not_found" when the coworker API returned 404, "terminal" when the response ended without a recoverable completion.
 */
export const recoverConversationResponse = withSession<
  RecoverConversationResponseParameters,
  Result<
    {
      recovered: boolean;
      reason?: "not_found" | "in_progress" | "terminal";
    },
    ActionError
  >
>(async ({ conversationId }) => {
  const result = await makeCoreApiRequest(() =>
    coreClient.postConversationsByIdRecoverResponse(conversationId),
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<
      {
        recovered: boolean;
        reason?: "not_found" | "in_progress" | "terminal";
      },
      ActionError
    >;
  }

  const value = result.value as
    | {
        recovered?: boolean;
        reason?: "not_found" | "in_progress" | "terminal";
      }
    | undefined;
  return {
    ok: true,
    data: {
      recovered: value?.recovered ?? false,
      reason: value?.reason,
    },
  } as unknown as Result<
    {
      recovered: boolean;
      reason?: "not_found" | "in_progress" | "terminal";
    },
    ActionError
  >;
});

/**
 * Gets a conversation by internal database ID via Core API
 * CRITICAL: Validates ownership before returning.
 * Fetches conversation items from the database.
 */
export const getConversation = withSession<
  GetConversationParameters,
  Result<ConversationWithItems, ActionError>
>(async ({ id }) => {
  // Fetch conversation metadata
  const conversationResult = await makeCoreApiRequest(() =>
    coreClient.getConversation(id),
  );

  if (conversationResult.isErr()) {
    return {
      ok: false,
      error: conversationResult.error,
    } as unknown as Result<ConversationWithItems, ActionError>;
  }

  // Fetch conversation items from database (limit 100 so list/conversation view has full history)
  const itemsResult = await getConversationItems({
    conversationId: id,
    limit: 100,
  });

  // Handle serialized Result format from getConversationItems
  if (
    itemsResult &&
    typeof itemsResult === "object" &&
    "ok" in itemsResult &&
    itemsResult.ok === false
  ) {
    // If items fetch fails, return conversation without items
    return {
      ok: true,
      data: {
        ...toConversation(conversationResult.value.data),
        items: [],
      },
    } as unknown as Result<ConversationWithItems, ActionError>;
  }

  // Extract items from serialized Result format
  const items =
    itemsResult &&
    typeof itemsResult === "object" &&
    "ok" in itemsResult &&
    itemsResult.ok === true &&
    "data" in itemsResult &&
    itemsResult.data &&
    typeof itemsResult.data === "object" &&
    "items" in itemsResult.data
      ? (itemsResult.data.items as ConversationItem[])
      : [];

  return {
    ok: true,
    data: {
      ...toConversation(conversationResult.value.data),
      items,
    },
  } as unknown as Result<ConversationWithItems, ActionError>;
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
 * Adds an item to a conversation via Core API
 * Used by chat route to store messages in conversations
 */
export const addConversationItem = withSession<
  AddConversationItemParameters,
  Result<{ id: string }, ActionError>
>(async ({ conversationId, role, content }) => {
  const result = await makeCoreApiRequest(() =>
    coreClient.addConversationItem(conversationId, {
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

  const item = result.value.data as ConversationItem | undefined;
  if (!item?.id) {
    return {
      ok: false,
      error: {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Failed to add conversation item",
      },
    } as unknown as Result<{ id: string }, ActionError>;
  }

  return {
    ok: true,
    data: { id: item.id },
  } as unknown as Result<{ id: string }, ActionError>;
});
