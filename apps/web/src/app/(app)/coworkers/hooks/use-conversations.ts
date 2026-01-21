"use client";

import { useCallback, useEffect, useState } from "react";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import {
  type Conversation,
  type ConversationWithItems,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "@/lib/actions/conversation";

interface UseConversationsReturn {
  conversations: Conversation[];
  selectedConversation: ConversationWithItems | null;
  isLoading: boolean;
  error: ActionError | null;
  createNewConversation: (
    metadata?: Record<string, unknown>,
    title?: string,
  ) => Promise<Conversation | null>;
  selectConversation: (id: string) => Promise<void>;
  updateSelectedConversation: (
    metadata?: Record<string, unknown>,
    title?: string,
  ) => Promise<void>;
  deleteSelectedConversation: () => Promise<void>;
  refreshConversations: () => Promise<void>;
}

/**
 * Hook for managing conversations via database-backed API.
 * Uses internal database IDs (never exposes OpenAI conversation IDs).
 */
export function useConversations(): UseConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationWithItems | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  /**
   * Creates a new OpenAI conversation and stores it in the database.
   */
  const createNewConversation = useCallback(
    async (
      metadata?: Record<string, unknown>,
      title?: string,
    ): Promise<Conversation | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await createConversation({ metadata, title });

        // Handle serialized Result from Next.js server action
        // neverthrow Results lose their methods when serialized, so we check the structure
        const resultAny = result as any;

        let isError = false;
        let value: Conversation | null = null;
        let error: ActionError | null = null;

        try {
          // Check for @/lib/ts-res format: { ok: true, data: T } or { ok: false, error: E }
          if (resultAny?.ok === true && resultAny?.data) {
            // Success case: { ok: true, data: Conversation }
            value = resultAny.data;
          } else if (resultAny?.ok === false && resultAny?.error) {
            // Error case: { ok: false, error: ActionError }
            isError = true;
            error = resultAny.error;
          } else if (typeof resultAny?.isErr === "function") {
            // It's a proper neverthrow Result (shouldn't happen after serialization, but handle it)
            isError = resultAny.isErr();
            if (isError) {
              error = resultAny.error;
            } else {
              value = resultAny.value;
            }
          } else if (
            resultAny?.id &&
            resultAny?.userId &&
            typeof resultAny.id === "string" &&
            typeof resultAny.userId === "string"
          ) {
            // Fallback: It's the Conversation object directly
            value = resultAny as Conversation;
          } else {
            // Unknown format, treat as error
            isError = true;
            error = {
              message: "Invalid response format",
              code: CommonErrorCode.INTERNAL_SERVER_ERROR,
            };
          }
        } catch (parseError) {
          isError = true;
          error = {
            message:
              parseError instanceof Error
                ? parseError.message
                : "Failed to parse result",
            code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          };
        }

        if (isError || error) {
          setError(
            error || {
              message: "Unknown error",
              code: CommonErrorCode.INTERNAL_SERVER_ERROR,
            },
          );
          setIsLoading(false);
          return null;
        }

        if (!value) {
          setError({
            message: "No conversation data returned",
            code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          });
          setIsLoading(false);
          return null;
        }

        const newConversation = value;
        setConversations((prev) => [newConversation, ...prev]);
        setSelectedConversation({ ...newConversation, items: [] }); // Select new conversation
        setIsLoading(false);
        return newConversation;
      } catch (error) {
        setError({
          message:
            error instanceof Error
              ? error.message
              : "Failed to create conversation",
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        });
        setIsLoading(false);
        return null;
      }
    },
    [],
  );

  /**
   * Helper to parse serialized Result objects from Next.js server actions
   */
  const parseServerActionResult = useCallback(
    <T, E extends ActionError>(
      rawResult: unknown,
    ): { isErr: boolean; value: T | null; error: E | null } => {
      const resultAny = rawResult as any;

      if (resultAny?.ok === true && resultAny?.data) {
        return { isErr: false, value: resultAny.data, error: null };
      } else if (resultAny?.ok === false && resultAny?.error) {
        return { isErr: true, value: null, error: resultAny.error };
      } else if (typeof resultAny?.isErr === "function") {
        // It's a proper neverthrow Result (shouldn't happen after serialization)
        return {
          isErr: resultAny.isErr(),
          value: resultAny.isErr() ? null : resultAny.value,
          error: resultAny.isErr() ? resultAny.error : null,
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
   * Selects and loads a conversation by internal database ID
   */
  const selectConversation = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const rawResult = await getConversation({ id });
        const result = parseServerActionResult<
          ConversationWithItems,
          ActionError
        >(rawResult);

        if (result.isErr) {
          setError(result.error);
          setIsLoading(false);
          return;
        }

        setSelectedConversation(result.value);
        setIsLoading(false);
      } catch (error) {
        setError({
          message:
            error instanceof Error
              ? error.message
              : "Failed to select conversation",
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        });
        setIsLoading(false);
      }
    },
    [parseServerActionResult],
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
        const rawResult = await updateConversation({
          id: selectedConversation.id,
          metadata,
          title,
        });
        const result = parseServerActionResult<Conversation, ActionError>(
          rawResult,
        );

        if (result.isErr) {
          setError(result.error);
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
        setError({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update conversation",
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        });
        setIsLoading(false);
      }
    },
    [selectedConversation, parseServerActionResult],
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
      const rawResult = await deleteConversation({
        id: selectedConversation.id,
      });
      const result = parseServerActionResult<{ success: boolean }, ActionError>(
        rawResult,
      );

      if (result.isErr) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      setConversations((prev) =>
        prev.filter((conv) => conv.id !== selectedConversation.id),
      );
      setSelectedConversation(null);
      setIsLoading(false);
    } catch (error) {
      setError({
        message:
          error instanceof Error
            ? error.message
            : "Failed to delete conversation",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
      setIsLoading(false);
    }
  }, [selectedConversation, parseServerActionResult]);

  /**
   * Refreshes the conversations list from the database
   */
  const refreshConversations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const rawResult = await listConversations({});
      const result = parseServerActionResult<Conversation[], ActionError>(
        rawResult,
      );

      if (result.isErr) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      setConversations(result.value || []);
      setIsLoading(false);
    } catch (error) {
      // Handle thrown errors (e.g., UnAuthenticatedError from withAuthContext)
      setError({
        message:
          error instanceof Error
            ? error.message
            : "Failed to refresh conversations",
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
      setIsLoading(false);
    }
  }, [parseServerActionResult]);

  // Load conversations on mount
  useEffect(() => {
    void refreshConversations();
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
    refreshConversations,
  };
}
