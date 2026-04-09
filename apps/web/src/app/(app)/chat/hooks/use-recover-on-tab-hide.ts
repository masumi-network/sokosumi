"use client";

import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";

import { convertItemsToMessages } from "@/app/chat/utils/message-utils";
import {
  getConversationMessages,
  recoverConversationResponse,
} from "@/lib/actions/conversation";

interface ConversationForRecovery {
  id: string;
  metadata?: Record<string, unknown> | null;
}

interface UseRecoverOnTabHideParams {
  selectedConversation: ConversationForRecovery | null | undefined;
  selectedChatId: string | null;
  setMessagesForConversation: (
    conversationId: string,
    messages: UIMessage[],
  ) => void;
  refreshConversations: () => void | Promise<unknown>;
}

/**
 * Listens for tab hide (visibility hidden) and proactively recovers any completed
 * coworker response so it is persisted before the SSE connection is throttled/closed.
 * On tab visible, refetches messages for that conversation if we recovered while hidden.
 */
export function useRecoverOnTabHide({
  selectedConversation,
  selectedChatId,
  setMessagesForConversation,
  refreshConversations,
}: UseRecoverOnTabHideParams): void {
  const recoveredConversationIdOnHideRef = useRef<string | null>(null);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const conv = selectedConversation;
      const cid = selectedChatId;
      if (document.visibilityState === "hidden") {
        if (!conv?.id || conv.id !== cid) return;
        const meta = (conv.metadata as Record<string, unknown> | null) ?? null;
        const isCoworker =
          meta?.type === "coworker" ||
          (typeof meta?.coworker_id === "string" &&
            meta.coworker_id.length > 0) ||
          (typeof meta?.coworker_slug === "string" &&
            meta.coworker_slug.length > 0);
        if (!isCoworker) return;
        const pendingId = meta?.pending_responses_api_response_id;
        if (typeof pendingId !== "string" || pendingId.length === 0) return;
        void recoverConversationResponse({ conversationId: conv.id }).then(
          (result) => {
            const recoverPayload =
              result &&
              typeof result === "object" &&
              "ok" in result &&
              result.ok
                ? (result as { data?: { recovered?: boolean } }).data
                : result && typeof result === "object" && "value" in result
                  ? (result as { value?: { recovered?: boolean } }).value
                  : undefined;
            if (recoverPayload?.recovered) {
              recoveredConversationIdOnHideRef.current = conv.id;
            }
          },
        );
        return;
      }
      if (document.visibilityState === "visible") {
        const refId = recoveredConversationIdOnHideRef.current;
        if (refId === null || refId !== cid) return;
        recoveredConversationIdOnHideRef.current = null;
        void getConversationMessages({
          conversationId: refId,
          limit: 100,
        }).then((itemsResult) => {
          const itemsPayload =
            itemsResult &&
            typeof itemsResult === "object" &&
            "ok" in itemsResult &&
            itemsResult.ok
              ? (itemsResult as { data?: { items?: unknown[] } }).data
              : itemsResult &&
                  typeof itemsResult === "object" &&
                  "value" in itemsResult
                ? (itemsResult as { value?: { items?: unknown[] } }).value
                : undefined;
          if (!itemsPayload || !Array.isArray(itemsPayload.items)) return;
          const newMessages = convertItemsToMessages(
            itemsPayload.items as Array<{
              id: string;
              role: string;
              content: Array<{ type: string; text?: string }> | string;
              createdAt: number;
            }>,
          );
          setMessagesForConversation(refId, newMessages);
          void refreshConversations();
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    selectedConversation,
    selectedChatId,
    setMessagesForConversation,
    refreshConversations,
  ]);
}
