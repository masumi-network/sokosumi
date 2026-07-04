"use client";

import type { UIMessage } from "ai";
import type { MutableRefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readPendingResponsesApiResponseIdFromMetadata } from "@/app/chat-ui/utils/conversation-metadata";
import { fetchConversationUiMessages } from "@/app/chat-ui/utils/fetch-conversation-ui-messages";
import { extractMessageContent } from "@/app/chat-ui/utils/message-utils";
import {
  hasGoodCoworkerAssistantTail,
  isStaleCoworkerAssistantTail,
} from "@/app/chat-ui/utils/sync-coworker-slot-from-db";

const DEFAULT_POLL_TIMEOUT_MS = 60_000;

function getPollTimeoutMs(): number {
  const ms = (globalThis as { __SOKOSUMI_TEST_POLL_TIMEOUT_MS?: number })
    .__SOKOSUMI_TEST_POLL_TIMEOUT_MS;
  if (typeof ms === "number" && ms > 0) return ms;
  return DEFAULT_POLL_TIMEOUT_MS;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

const CONVERSATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isConversationUuid(value: string): boolean {
  return CONVERSATION_UUID_RE.test(value.trim());
}

function hasNonEmptyAssistantTail(messages: UIMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  return extractMessageContent(last).trim().length > 0;
}

function isLastMessageUserWithText(messages: UIMessage[]): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (last.role !== "user") return false;
  return extractMessageContent(last).trim().length > 0;
}

export interface UseCoworkerPostRefreshAssistantPollParams {
  conversationId: string | null;
  isCoworkerThread: boolean;
  isChatStreaming: boolean;
  conversationMetadata: Record<string, unknown> | null | undefined;
  messagesChatIdRef: MutableRefObject<string | null>;
  displayedMessages: UIMessage[];
  setMessagesForConversation: (
    convId: string,
    messages: UIMessage[],
    options?: { forceFromDb?: boolean },
  ) => void;
  refreshConversations: () => Promise<unknown>;
}

export interface UseCoworkerPostRefreshAssistantPollResult {
  userTailRecoveryLoading: boolean;
  userTailRecoveryFailed: boolean;
}

export function useCoworkerPostRefreshAssistantPoll({
  conversationId,
  isCoworkerThread,
  isChatStreaming,
  conversationMetadata,
  messagesChatIdRef,
  displayedMessages,
  setMessagesForConversation,
  refreshConversations,
}: UseCoworkerPostRefreshAssistantPollParams): UseCoworkerPostRefreshAssistantPollResult {
  const [userTailRecoveryLoading, setUserTailRecoveryLoading] = useState(false);
  const [userTailRecoveryFailed, setUserTailRecoveryFailed] = useState(false);
  const pollGenerationRef = useRef(0);

  const pendingApiFingerprint = useMemo(
    () =>
      readPendingResponsesApiResponseIdFromMetadata(conversationMetadata) ?? "",
    [conversationMetadata],
  );

  const messageTailFingerprint = useMemo(() => {
    const m = displayedMessages;
    if (m.length === 0) return "empty";
    const last = m[m.length - 1];
    const id = typeof last.id === "string" ? last.id : "";
    const role = last.role;
    const text =
      role === "user" ? extractMessageContent(last).slice(0, 64) : "";
    return `${m.length}:${id}:${role}:${text}`;
  }, [displayedMessages]);

  useEffect(() => {
    if (!conversationId || !isConversationUuid(conversationId)) {
      setUserTailRecoveryLoading(false);
      setUserTailRecoveryFailed(false);
      return;
    }

    if (!isCoworkerThread) {
      setUserTailRecoveryLoading(false);
      setUserTailRecoveryFailed(false);
      return;
    }

    if (isChatStreaming) {
      setUserTailRecoveryLoading(false);
      setUserTailRecoveryFailed(false);
      return;
    }

    if (messagesChatIdRef.current !== conversationId) {
      setUserTailRecoveryLoading(false);
      setUserTailRecoveryFailed(false);
      return;
    }

    if (hasGoodCoworkerAssistantTail(displayedMessages)) {
      setUserTailRecoveryLoading(false);
      setUserTailRecoveryFailed(false);
      return;
    }

    const needsRecovery =
      isLastMessageUserWithText(displayedMessages) ||
      isStaleCoworkerAssistantTail(displayedMessages);

    if (!needsRecovery) {
      setUserTailRecoveryLoading(false);
      setUserTailRecoveryFailed(false);
      return;
    }

    const generation = pollGenerationRef.current;

    function isStale(): boolean {
      return pollGenerationRef.current !== generation;
    }

    void (async () => {
      setUserTailRecoveryFailed(false);
      setUserTailRecoveryLoading(true);

      const pollStartedAt = Date.now();
      const pollTimeoutMs = getPollTimeoutMs();
      let backoffMs = INITIAL_BACKOFF_MS;

      while (true) {
        if (isStale()) {
          setUserTailRecoveryLoading(false);
          return;
        }

        if (Date.now() - pollStartedAt >= pollTimeoutMs) {
          setUserTailRecoveryLoading(false);
          setUserTailRecoveryFailed(true);
          return;
        }

        const dbMessages = await fetchConversationUiMessages(conversationId);
        if (isStale()) {
          setUserTailRecoveryLoading(false);
          return;
        }

        if (dbMessages && dbMessages.length > 0) {
          if (hasGoodCoworkerAssistantTail(dbMessages)) {
            setMessagesForConversation(conversationId, dbMessages, {
              forceFromDb: true,
            });
            void refreshConversations();
            if (!isStale()) {
              setUserTailRecoveryLoading(false);
              setUserTailRecoveryFailed(false);
            }
            return;
          }
        }

        const remaining = pollTimeoutMs - (Date.now() - pollStartedAt);
        if (remaining <= 0) {
          setUserTailRecoveryLoading(false);
          setUserTailRecoveryFailed(true);
          return;
        }

        const sleep = Math.min(backoffMs, Math.max(0, remaining));
        await new Promise((r) => setTimeout(r, sleep));
        if (isStale()) {
          setUserTailRecoveryLoading(false);
          return;
        }

        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    })();

    return () => {
      pollGenerationRef.current += 1;
      setUserTailRecoveryLoading(false);
    };
  }, [
    conversationId,
    isCoworkerThread,
    isChatStreaming,
    pendingApiFingerprint,
    messageTailFingerprint,
    messagesChatIdRef,
    setMessagesForConversation,
    refreshConversations,
  ]);

  useEffect(() => {
    if (
      userTailRecoveryFailed &&
      (isChatStreaming || hasNonEmptyAssistantTail(displayedMessages))
    ) {
      setUserTailRecoveryFailed(false);
    }
  }, [userTailRecoveryFailed, isChatStreaming, messageTailFingerprint]);

  return {
    userTailRecoveryLoading,
    userTailRecoveryFailed,
  };
}
