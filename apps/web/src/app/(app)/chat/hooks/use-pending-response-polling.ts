"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import { convertItemsToMessages } from "@/app/chat/utils/message-utils";
import { getConversationItems } from "@/lib/actions/conversation/core-api-actions";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_COUNT = 60; // 2 minutes at 2s interval

interface ConversationItemShape {
  id: string;
  role: string;
  content: Array<{ type: string; text?: string }> | string;
  createdAt: number;
}

function parseItemsResult(raw: unknown): ConversationItemShape[] | null {
  const r = raw as
    | { ok: true; data: { items: ConversationItemShape[] } }
    | { isOk: () => boolean; value?: { items: ConversationItemShape[] } };
  if (r && typeof r === "object" && "ok" in r && r.ok === true && "data" in r) {
    const data = (r as { data: { items: ConversationItemShape[] } }).data;
    return Array.isArray(data?.items) ? data.items : null;
  }
  if (
    r &&
    typeof r === "object" &&
    "isOk" in r &&
    typeof (r as { isOk: () => boolean }).isOk === "function"
  ) {
    if ((r as { isOk: () => boolean }).isOk() && "value" in r && r.value) {
      const items = (r.value as { items: ConversationItemShape[] }).items;
      return Array.isArray(items) ? items : null;
    }
  }
  return null;
}

export interface UsePendingResponsePollingProps {
  selectedChatId: string | null;
  displayedMessages: UIMessage[];
  isStreaming: boolean;
  /** When true, recovery is running or will run; do not poll (recover endpoint handles it). */
  hasPendingIdInMetadata?: boolean;
  setMessagesForConversation: (convId: string, messages: UIMessage[]) => void;
  refreshConversations: () => Promise<unknown>;
}

/**
 * When the user refreshes during a long stream, the backend keeps running and
 * persists the assistant message. This hook polls for that message until it
 * appears, then updates the UI and refreshes the sidebar.
 */
export function usePendingResponsePolling({
  selectedChatId,
  displayedMessages,
  isStreaming,
  hasPendingIdInMetadata = false,
  setMessagesForConversation,
  refreshConversations,
}: UsePendingResponsePollingProps) {
  const [isPollingForPendingResponse, setIsPollingForPendingResponse] =
    useState(false);
  const [pendingResponseFailed, setPendingResponseFailed] = useState(false);
  const pollCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lastMessageRole =
    displayedMessages.length > 0
      ? (displayedMessages[displayedMessages.length - 1].role as string)
      : null;

  const shouldPoll =
    Boolean(selectedChatId) &&
    lastMessageRole === "user" &&
    !isStreaming &&
    !hasPendingIdInMetadata &&
    displayedMessages.length > 0;

  const poll = useCallback(async () => {
    if (!selectedChatId) return;
    pollCountRef.current += 1;
    if (pollCountRef.current > MAX_POLL_COUNT) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPollingForPendingResponse(false);
      setPendingResponseFailed(true);
      return;
    }
    try {
      const raw = await getConversationItems({
        conversationId: selectedChatId,
        limit: 100,
      });
      const items = parseItemsResult(raw);
      if (!items || items.length === 0) return;
      const lastItem = items[items.length - 1];
      if (lastItem.role !== "assistant") return;
      const newMessages = convertItemsToMessages(items);
      setMessagesForConversation(selectedChatId, newMessages);
      void refreshConversations();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPollingForPendingResponse(false);
    } catch (error) {
      console.error("Pending response poll failed:", error);
    }
  }, [selectedChatId, setMessagesForConversation, refreshConversations]);

  useEffect(() => {
    if (!shouldPoll) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      pollCountRef.current = 0;
      queueMicrotask(() => {
        setIsPollingForPendingResponse(false);
        setPendingResponseFailed(false);
      });
      return;
    }
    pollCountRef.current = 0;
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    queueMicrotask(() => {
      setIsPollingForPendingResponse(true);
      poll();
    });
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [shouldPoll, poll]);

  const clearPendingResponseFailed = useCallback(() => {
    setPendingResponseFailed(false);
  }, []);

  return {
    isPollingForPendingResponse,
    pendingResponseFailed,
    clearPendingResponseFailed,
  };
}
