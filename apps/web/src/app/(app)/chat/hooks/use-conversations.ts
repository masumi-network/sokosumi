"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import {
  type Conversation,
  type ConversationWithItems,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "@/lib/actions/conversation/core-api-actions";

const CONVERSATION_RETRY_ATTEMPTS = 2;
const CONVERSATION_RETRY_DELAY_MS = 1500;

function isRetryableNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("unavailable") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("network error")
  );
}

function getConversationToastMessage(
  rawMessage: string,
  networkFallback: string,
): string {
  return isRetryableNetworkError(rawMessage) ? networkFallback : rawMessage;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries: number; delayMs: number },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      if (attempt < options.retries && isRetryableNetworkError(message)) {
        await new Promise((r) => setTimeout(r, options.delayMs));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

interface UseConversationsReturn {
  conversations: Conversation[];
  selectedConversation: ConversationWithItems | null;
  isLoading: boolean;
  error: ActionError | null;
  createNewConversation: (
    metadata?: Record<string, unknown>,
    title?: string,
  ) => Promise<Conversation | null>;
  selectConversation: (id: string) => Promise<ConversationWithItems | null>;
  updateSelectedConversation: (
    metadata?: Record<string, unknown>,
    title?: string,
  ) => Promise<void>;
  deleteSelectedConversation: () => Promise<void>;
  deleteConversationById: (id: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
}

/**
 * Hook for managing conversations via database-backed API.
 * Uses internal database IDs.
 */
export function useConversations(): UseConversationsReturn {
  const t = useTranslations("App.Chat.Chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationWithItems | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const networkErrorToastMessage = t("networkErrorAfterRetry");

  /**
   * Helper to parse serialized Result objects from Next.js server actions
   */
  const parseServerActionResult = useCallback(
    <T, E extends ActionError>(
      rawResult: unknown,
    ): { isErr: boolean; value: T | null; error: E | null } => {
      const raw = rawResult as
        | {
            ok?: boolean;
            data?: T;
            error?: E;
            isErr?: () => boolean;
            value?: T;
          }
        | null
        | undefined;

      if (raw?.ok === true && raw?.data !== undefined) {
        return { isErr: false, value: raw.data, error: null };
      }
      if (raw?.ok === false && raw?.error) {
        return { isErr: true, value: null, error: raw.error };
      }
      if (typeof raw?.isErr === "function") {
        // It's a proper neverthrow Result (shouldn't happen after serialization)
        return {
          isErr: raw.isErr(),
          value: raw.isErr() ? null : (raw.value ?? null),
          error: (raw.isErr() ? (raw as { error?: E }).error : null) ?? null,
        };
      }

      // Unknown format, treat as error
      return {
        isErr: true,
        value: null,
        error: {
          message: "Invalid response format",
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        } as E,
      };
    },
    [],
  );

  /**
   * Refreshes the conversations list from the database
   */
  const refreshConversations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const rawResult = await withRetry(() => listConversations({}), {
        retries: CONVERSATION_RETRY_ATTEMPTS,
        delayMs: CONVERSATION_RETRY_DELAY_MS,
      });
      const result = parseServerActionResult<Conversation[], ActionError>(
        rawResult,
      );

      if (result.isErr) {
        const error = result.error;
        setError(error);

        const errorMessage =
          error?.message || "Failed to refresh conversations";
        const toastMessage = getConversationToastMessage(
          errorMessage,
          networkErrorToastMessage,
        );
        const isServiceUnavailable = errorMessage.includes("unavailable");

        toast.error(toastMessage, {
          description: isServiceUnavailable
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
        return;
      }

      setConversations(result.value || []);
      setIsLoading(false);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to refresh conversations";
      setError({
        message: errorMessage,
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });

      const toastMessage = getConversationToastMessage(
        errorMessage,
        networkErrorToastMessage,
      );
      const isServiceUnavailable = errorMessage.includes("unavailable");

      toast.error(toastMessage, {
        description: isServiceUnavailable
          ? "The conversation service is temporarily unavailable. Please try again in a moment."
          : undefined,
      });

      setIsLoading(false);
    }
  }, [parseServerActionResult, networkErrorToastMessage]);

  /**
   * Creates a new conversation and stores it in the database.
   */
  const createNewConversation = useCallback(
    async (
      metadata?: Record<string, unknown>,
      title?: string,
    ): Promise<Conversation | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const rawResult = await withRetry(
          () => createConversation({ metadata, title }),
          {
            retries: CONVERSATION_RETRY_ATTEMPTS,
            delayMs: CONVERSATION_RETRY_DELAY_MS,
          },
        );
        const result = parseServerActionResult<Conversation, ActionError>(
          rawResult,
        );

        if (result.isErr) {
          const error = result.error;
          setError(error);

          const errorMessage =
            error?.message || "Failed to create conversation";
          const toastMessage = getConversationToastMessage(
            errorMessage,
            networkErrorToastMessage,
          );
          toast.error(toastMessage, {
            description: errorMessage.includes("unavailable")
              ? "The conversation service is temporarily unavailable. Please try again in a moment."
              : undefined,
          });

          setIsLoading(false);
          return null;
        }

        if (!result.value) {
          setError({
            message: "No conversation data returned",
            code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          });
          setIsLoading(false);
          return null;
        }

        const newConversation = result.value;
        setConversations((prev) => [newConversation, ...prev]);
        setSelectedConversation({ ...newConversation, items: [] }); // Select new conversation

        // Refresh conversations list to ensure deleted conversations are excluded
        // This ensures we have the latest state from DB after creating a new conversation
        void refreshConversations();

        setIsLoading(false);
        return newConversation;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to create conversation";
        setError({
          message: errorMessage,
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        });

        const toastMessage = getConversationToastMessage(
          errorMessage,
          networkErrorToastMessage,
        );
        toast.error(toastMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
        return null;
      }
    },
    [parseServerActionResult, refreshConversations, networkErrorToastMessage],
  );

  /**
   * Selects and loads a conversation by internal database ID
   */
  const selectConversation = useCallback(
    async (id: string): Promise<ConversationWithItems | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const rawResult = await withRetry(() => getConversation({ id }), {
          retries: CONVERSATION_RETRY_ATTEMPTS,
          delayMs: CONVERSATION_RETRY_DELAY_MS,
        });
        const result = parseServerActionResult<
          ConversationWithItems,
          ActionError
        >(rawResult);

        if (result.isErr) {
          setError(result.error);
          setIsLoading(false);
          return null;
        }

        const conversation = result.value;
        setSelectedConversation(conversation);
        // Ensure conversation is in the list when loaded by ID (e.g. from URL on refresh)
        setConversations((prev) =>
          prev.some((c) => c.id === conversation.id)
            ? prev
            : [conversation, ...prev],
        );
        setIsLoading(false);
        return conversation;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to select conversation";
        setError({
          message: errorMessage,
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        });

        const toastMessage = getConversationToastMessage(
          errorMessage,
          networkErrorToastMessage,
        );
        toast.error(toastMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
        return null;
      }
    },
    [parseServerActionResult, networkErrorToastMessage],
  );

  /**
   * Updates the selected conversation's metadata
   */
  const updateSelectedConversation = useCallback(
    async (metadata?: Record<string, unknown>, title?: string) => {
      if (!selectedConversation) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const rawResult = await withRetry(
          () =>
            updateConversation({
              id: selectedConversation.id,
              metadata,
              title,
            }),
          {
            retries: CONVERSATION_RETRY_ATTEMPTS,
            delayMs: CONVERSATION_RETRY_DELAY_MS,
          },
        );
        const result = parseServerActionResult<Conversation, ActionError>(
          rawResult,
        );

        if (result.isErr) {
          const error = result.error;
          setError(error);

          const errorMessage =
            error?.message || "Failed to update conversation";
          const toastMessage = getConversationToastMessage(
            errorMessage,
            networkErrorToastMessage,
          );
          toast.error(toastMessage, {
            description: errorMessage.includes("unavailable")
              ? "The conversation service is temporarily unavailable. Please try again in a moment."
              : undefined,
          });

          setIsLoading(false);
          return;
        }

        const updatedConversation = result.value;
        if (updatedConversation) {
          setSelectedConversation((prev) =>
            prev ? { ...prev, ...updatedConversation } : null,
          );
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === updatedConversation.id ? updatedConversation : conv,
            ),
          );
        }
        setIsLoading(false);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to update conversation";
        setError({
          message: errorMessage,
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        });

        const toastMessage = getConversationToastMessage(
          errorMessage,
          networkErrorToastMessage,
        );
        toast.error(toastMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
      }
    },
    [selectedConversation, parseServerActionResult, networkErrorToastMessage],
  );

  /**
   * Deletes the selected conversation
   */
  const deleteSelectedConversation = useCallback(async () => {
    if (!selectedConversation) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const rawResult = await withRetry(
        () => deleteConversation({ id: selectedConversation.id }),
        {
          retries: CONVERSATION_RETRY_ATTEMPTS,
          delayMs: CONVERSATION_RETRY_DELAY_MS,
        },
      );
      const result = parseServerActionResult<Conversation, ActionError>(
        rawResult,
      );

      if (result.isErr) {
        const error = result.error;
        setError(error);

        const errorMessage = error?.message || "Failed to delete conversation";
        const toastMessage = getConversationToastMessage(
          errorMessage,
          networkErrorToastMessage,
        );
        toast.error(toastMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
        return;
      }

      // Remove from local state immediately for responsive UI
      setConversations((prev) =>
        prev.filter((conv) => conv.id !== selectedConversation.id),
      );
      setSelectedConversation(null);

      // Refresh conversations list to ensure we have the latest state from DB
      // This ensures deleted conversations stay excluded even after other operations
      void refreshConversations();

      setIsLoading(false);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to delete conversation";
      setError({
        message: errorMessage,
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });

      const toastMessage = getConversationToastMessage(
        errorMessage,
        networkErrorToastMessage,
      );
      toast.error(toastMessage, {
        description: errorMessage.includes("unavailable")
          ? "The conversation service is temporarily unavailable. Please try again in a moment."
          : undefined,
      });

      setIsLoading(false);
    }
  }, [
    selectedConversation,
    parseServerActionResult,
    refreshConversations,
    networkErrorToastMessage,
  ]);

  /**
   * Deletes a conversation by ID (can be any conversation, not just the selected one)
   */
  const deleteConversationById = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const rawResult = await withRetry(() => deleteConversation({ id }), {
          retries: CONVERSATION_RETRY_ATTEMPTS,
          delayMs: CONVERSATION_RETRY_DELAY_MS,
        });
        const result = parseServerActionResult<Conversation, ActionError>(
          rawResult,
        );

        if (result.isErr) {
          const error = result.error;
          setError(error);

          const errorMessage =
            error?.message || "Failed to delete conversation";
          const toastMessage = getConversationToastMessage(
            errorMessage,
            networkErrorToastMessage,
          );
          toast.error(toastMessage, {
            description: errorMessage.includes("unavailable")
              ? "The conversation service is temporarily unavailable. Please try again in a moment."
              : undefined,
          });

          setIsLoading(false);
          return;
        }

        // Remove from local state immediately for responsive UI
        setConversations((prev) => prev.filter((conv) => conv.id !== id));

        // If this was the selected conversation, clear selection
        if (selectedConversation?.id === id) {
          setSelectedConversation(null);
        }

        // Refresh conversations list to ensure we have the latest state from DB
        // This ensures deleted conversations stay excluded even after other operations
        void refreshConversations();

        setIsLoading(false);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to delete conversation";
        setError({
          message: errorMessage,
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        });

        const toastMessage = getConversationToastMessage(
          errorMessage,
          networkErrorToastMessage,
        );
        toast.error(toastMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
      }
    },
    [
      parseServerActionResult,
      refreshConversations,
      selectedConversation,
      networkErrorToastMessage,
    ],
  );

  // Load conversations on mount (defer to avoid synchronous setState in effect)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshConversations();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [refreshConversations]);

  // Refresh conversations when page becomes visible (user navigates back)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshConversations();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshConversations]);

  return {
    conversations,
    selectedConversation,
    isLoading,
    error,
    createNewConversation,
    selectConversation,
    updateSelectedConversation,
    deleteSelectedConversation,
    deleteConversationById,
    refreshConversations,
  };
}
