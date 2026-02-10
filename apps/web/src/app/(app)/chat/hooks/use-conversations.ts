"use client";

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationWithItems | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

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
        const error = result.error;
        setError(error);

        // Show user-friendly error message
        const errorMessage =
          error?.message || "Failed to refresh conversations";
        const isServiceUnavailable = errorMessage.includes("unavailable");

        toast.error(errorMessage, {
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
      // Handle thrown errors (e.g., UnAuthenticatedError from withAuthContext)
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to refresh conversations";
      setError({
        message: errorMessage,
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });

      toast.error(errorMessage, {
        description: errorMessage.includes("unavailable")
          ? "The conversation service is temporarily unavailable. Please try again in a moment."
          : undefined,
      });

      setIsLoading(false);
    }
  }, [parseServerActionResult]);

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
        const rawResult = await createConversation({ metadata, title });
        const result = parseServerActionResult<Conversation, ActionError>(
          rawResult,
        );

        if (result.isErr) {
          const error = result.error;
          setError(error);

          // Show user-friendly error message
          const errorMessage =
            error?.message || "Failed to create conversation";
          toast.error(errorMessage, {
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

        toast.error(errorMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
        return null;
      }
    },
    [refreshConversations],
  );

  /**
   * Selects and loads a conversation by internal database ID
   */
  const selectConversation = useCallback(
    async (id: string): Promise<ConversationWithItems | null> => {
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
          return null;
        }

        const conversation = result.value;
        setSelectedConversation(conversation);
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

        toast.error(errorMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
        return null;
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
          const error = result.error;
          setError(error);

          // Show user-friendly error message
          const errorMessage =
            error?.message || "Failed to update conversation";
          toast.error(errorMessage, {
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

        toast.error(errorMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
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
      const result = parseServerActionResult<Conversation, ActionError>(
        rawResult,
      );

      if (result.isErr) {
        const error = result.error;
        setError(error);

        // Show user-friendly error message
        const errorMessage = error?.message || "Failed to delete conversation";
        toast.error(errorMessage, {
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

      toast.error(errorMessage, {
        description: errorMessage.includes("unavailable")
          ? "The conversation service is temporarily unavailable. Please try again in a moment."
          : undefined,
      });

      setIsLoading(false);
    }
  }, [selectedConversation, parseServerActionResult, refreshConversations]);

  /**
   * Deletes a conversation by ID (can be any conversation, not just the selected one)
   */
  const deleteConversationById = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const rawResult = await deleteConversation({ id });
        const result = parseServerActionResult<Conversation, ActionError>(
          rawResult,
        );

        if (result.isErr) {
          const error = result.error;
          setError(error);

          // Show user-friendly error message
          const errorMessage =
            error?.message || "Failed to delete conversation";
          toast.error(errorMessage, {
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

        toast.error(errorMessage, {
          description: errorMessage.includes("unavailable")
            ? "The conversation service is temporarily unavailable. Please try again in a moment."
            : undefined,
        });

        setIsLoading(false);
      }
    },
    [parseServerActionResult, refreshConversations, selectedConversation],
  );

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
    deleteConversationById,
    refreshConversations,
  };
}
