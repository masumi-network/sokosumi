"use server";

import { err, ok, type Result } from "neverthrow";
import { headers } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";
import { ActionError, CommonErrorCode } from "@/lib/actions";
import { buildAuthHeaders } from "@/lib/clients/core.client";
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
  role: "user" | "assistant";
  content: Array<{ type: string; text?: string }> | string;
}

interface GetConversationItemsParameters extends AuthenticatedRequest {
  conversationId: string; // Internal database ID
  limit?: number;
  after?: string;
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
  role: "user" | "assistant";
  content: Array<{ type: string; text?: string }> | string;
  createdAt: number;
}

export interface ConversationWithItems extends Conversation {
  items?: ConversationItem[];
}

/**
 * Helper function to make authenticated requests to Core API
 * Uses the same auth header building logic as coreClient but with better error handling
 */
async function makeCoreApiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<Result<T, ActionError>> {
  try {
    const requestHeaders = await headers();
    const authHeaders = buildAuthHeaders(requestHeaders);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    const coreApiUrl = getEnvSecrets().CORE_API_URL;
    const fullUrl = `${coreApiUrl}${normalizedPath}`;
    let response: Response;
    try {
      response = await fetch(fullUrl, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
          ...options.headers,
        },
      });
    } catch (fetchError) {
      throw fetchError;
    }

    if (!response.ok) {
      // Try to parse error response
      let errorMessage = `API error: ${response.status}`;
      let errorCode = CommonErrorCode.INTERNAL_SERVER_ERROR;

      try {
        const errorData = (await response.json()) as {
          error?: string;
          message?: string;
        };

        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        // If we can't parse the error response, use status code
      }

      // Map HTTP status codes to error codes
      const status = response.status;
      if (status === 401) {
        errorCode = CommonErrorCode.UNAUTHORIZED;
      } else if (status === 403) {
        errorCode = CommonErrorCode.UNAUTHORIZED;
      } else if (status === 404) {
        errorCode = CommonErrorCode.BAD_INPUT;
      } else if (status === 409) {
        errorCode = CommonErrorCode.BAD_INPUT;
      } else if (status === 422) {
        errorCode = CommonErrorCode.BAD_INPUT;
      } else if (status === 500) {
        // Internal Server Error - could be API key configuration issue
        errorCode = CommonErrorCode.INTERNAL_SERVER_ERROR;
        // Check if it's an API key configuration error
        if (
          errorMessage.includes("API key") ||
          errorMessage.includes("api key") ||
          errorMessage.includes("invalid_api_key") ||
          errorMessage.includes("missing_api_key")
        ) {
          // Keep the specific API key error message from backend
          // Don't override it with generic message
        }
      } else if (status === 503) {
        // Service Unavailable - API is down
        errorCode = CommonErrorCode.INTERNAL_SERVER_ERROR;
        // Enhance error message for API unavailability
        if (!errorMessage.includes("unavailable")) {
          errorMessage = "The conversation service is currently unavailable.";
        }
      }

      return err({
        message: errorMessage,
        code: errorCode,
      } as ActionError);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return ok({} as T);
    }

    const jsonData = await response.json();
    const data = jsonData as { data: T; meta?: unknown };
    return ok(data.data);
  } catch (error) {
    return err({
      message:
        error instanceof Error
          ? error.message
          : "Failed to communicate with Core API",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    } as ActionError);
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
  const result = await makeCoreApiRequest<Conversation[]>("/v1/conversations", {
    method: "GET",
  });

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<Conversation[], ActionError>;
  }

  return {
    ok: true,
    data: result.value,
  } as unknown as Result<Conversation[], ActionError>;
});

/**
 * Gets conversation items (messages) by conversation ID via Core API
 * CRITICAL: Validates ownership before returning.
 */
export const getConversationItems = withAuthContext<
  GetConversationItemsParameters,
  Result<ConversationItem[], ActionError>
>(async ({ conversationId, limit, after }) => {
  const queryParams = new URLSearchParams();
  if (limit !== undefined) {
    queryParams.append("limit", limit.toString());
  }
  if (after) {
    queryParams.append("after", after);
  }
  const queryString = queryParams.toString();
  const path = `/v1/conversations/${conversationId}/items${
    queryString ? `?${queryString}` : ""
  }`;

  const result = await makeCoreApiRequest<ConversationItem[]>(path, {
    method: "GET",
  });

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<ConversationItem[], ActionError>;
  }

  return {
    ok: true,
    data: result.value,
  } as unknown as Result<ConversationItem[], ActionError>;
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
  const conversationResult = await makeCoreApiRequest<Conversation>(
    `/v1/conversations/${id}`,
    {
      method: "GET",
    },
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
        ...conversationResult.value,
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
    "data" in itemsResult
      ? itemsResult.data
      : [];

  return {
    ok: true,
    data: {
      ...conversationResult.value,
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
  const result = await makeCoreApiRequest<Conversation>("/v1/conversations", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<Conversation, ActionError>;
  }

  return {
    ok: true,
    data: result.value,
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
  const result = await makeCoreApiRequest<Conversation>(
    `/v1/conversations/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        title,
        metadata,
      }),
    },
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<Conversation, ActionError>;
  }

  return {
    ok: true,
    data: result.value,
  } as unknown as Result<Conversation, ActionError>;
});

/**
 * Soft deletes a conversation via Core API
 * CRITICAL: Validates ownership before deleting.
 */
export const deleteConversation = withAuthContext<
  GetConversationParameters,
  Result<{ success: boolean }, ActionError>
>(async ({ id }) => {
  const result = await makeCoreApiRequest<void>(`/v1/conversations/${id}`, {
    method: "DELETE",
  });

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<{ success: boolean }, ActionError>;
  }

  return {
    ok: true,
    data: { success: true },
  } as unknown as Result<{ success: boolean }, ActionError>;
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
  const result = await makeCoreApiRequest<Conversation>(
    `/v1/conversations/${id}`,
    {
      method: "GET",
    },
  );

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
  const result = await makeCoreApiRequest<{ id: string }>(
    `/v1/conversations/${conversationId}/items`,
    {
      method: "POST",
      body: JSON.stringify({
        role,
        content,
      }),
    },
  );

  if (result.isErr()) {
    return {
      ok: false,
      error: result.error,
    } as unknown as Result<{ id: string }, ActionError>;
  }

  return {
    ok: true,
    data: result.value,
  } as unknown as Result<{ id: string }, ActionError>;
});
