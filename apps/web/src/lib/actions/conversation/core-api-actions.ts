"use server";

import { err, ok, type Result } from "neverthrow";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  type CoreApiPagination,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

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

export interface Conversation {
  id: string;
  userId: string;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: Array<{ type: string; text?: string }> | string;
  createdAt: number;
}

export interface ConversationWithItems extends Conversation {
  items?: ConversationItem[];
}

/**
 * Normalize date fields to ISO strings. coreClient returns Date instances;
 * we convert to string for the Conversation type (server action result / JSON).
 */
function toIsoString(value: Date | string | unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  const parsedDate = new Date(String(value));
  return Number.isNaN(parsedDate.getTime())
    ? new Date(0).toISOString()
    : parsedDate.toISOString();
}

function toConversation(conversation: {
  id: string;
  userId: string;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}): Conversation {
  return {
    ...conversation,
    createdAt: toIsoString(conversation.createdAt),
    updatedAt: toIsoString(conversation.updatedAt),
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
export const listConversations = withAuthContext<
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
    toConversation(
      conversation as {
        id: string;
        userId: string;
        title?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: Date;
        updatedAt: Date;
      },
    ),
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
export const getConversationItems = withAuthContext<
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
 * Gets a conversation by internal database ID via Core API
 * CRITICAL: Validates ownership before returning.
 * Fetches conversation items from the database.
 */
export const getConversation = withAuthContext<
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

  // Fetch conversation items from database
  const itemsResult = await getConversationItems({ conversationId: id });

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
        ...toConversation(
          conversationResult.value.data as {
            id: string;
            userId: string;
            title?: string | null;
            metadata?: Record<string, unknown> | null;
            createdAt: Date;
            updatedAt: Date;
          },
        ),
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
      ...toConversation(
        conversationResult.value.data as {
          id: string;
          userId: string;
          title?: string | null;
          metadata?: Record<string, unknown> | null;
          createdAt: Date;
          updatedAt: Date;
        },
      ),
      items,
    },
  } as unknown as Result<ConversationWithItems, ActionError>;
});

/**
 * Creates a new conversation via Core API
 */
export const createConversation = withAuthContext<
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
    data: toConversation(
      result.value.data as {
        id: string;
        userId: string;
        title?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: Date;
        updatedAt: Date;
      },
    ),
  } as unknown as Result<Conversation, ActionError>;
});

/**
 * Updates a conversation via Core API
 * CRITICAL: Validates ownership before updating.
 */
export const updateConversation = withAuthContext<
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
    data: toConversation(
      result.value.data as {
        id: string;
        userId: string;
        title?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: Date;
        updatedAt: Date;
      },
    ),
  } as unknown as Result<Conversation, ActionError>;
});

/**
 * Archives a conversation via Core API
 * CRITICAL: Validates ownership before archiving.
 */
export const deleteConversation = withAuthContext<
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
    data: toConversation(
      result.value.data as {
        id: string;
        userId: string;
        title?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: Date;
        updatedAt: Date;
      },
    ),
  } as unknown as Result<Conversation, ActionError>;
});

/**
 * Validates that a conversation exists and belongs to the user via Core API
 * CRITICAL: Validates ownership before returning.
 * Returns the internal conversation ID for use with API endpoints.
 */
export const getConversationId = withAuthContext<
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
export const addConversationItem = withAuthContext<
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
