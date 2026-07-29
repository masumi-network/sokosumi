import { useCallback, useEffect, useRef, useState } from "react";
import type { OrbState } from "thinking-orbs";
import { streamChatTurn } from "./stream-chat-turn";
import { DEFAULT_THINKING_STATE } from "./thinking-orb";
import type { Message, ProgressStep } from "./types";

interface UseChatSendOptions {
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  mockReplies: string[];
  previewMode: boolean;
  hasAssistantPlanCoverage: boolean;
  onRequireSubscription?: () => void;
  onRefresh?: () => void | Promise<void>;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function useChatSend({
  files,
  setFiles,
  setInput,
  messages,
  setMessages,
  mockReplies,
  previewMode,
  hasAssistantPlanCoverage,
  onRequireSubscription,
  onRefresh,
  t,
}: UseChatSendOptions) {
  const [isReplying, setIsReplying] = useState(false);
  const [progressChips, setProgressChips] = useState<ProgressStep[]>([]);
  const [thinkingState, setThinkingState] = useState<OrbState>(
    DEFAULT_THINKING_STATE,
  );
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [durations, setDurations] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [stepsByKey, setStepsByKey] = useState<Map<string, ProgressStep[]>>(
    () => new Map(),
  );

  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const reasoningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasoningClearAtRef = useRef(0);
  const turnStepsRef = useRef<ProgressStep[]>([]);
  const isReplyingRef = useRef(false);

  useEffect(() => {
    isReplyingRef.current = isReplying;
  }, [isReplying]);

  useEffect(() => {
    return () => {
      if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
      if (reasoningTimerRef.current) clearTimeout(reasoningTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      const hasFiles = files.length > 0;
      if ((!trimmed && !hasFiles) || isReplying) return;

      if (!previewMode && !hasAssistantPlanCoverage) {
        onRequireSubscription?.();
        return;
      }

      const now = Date.now();
      const fileNote = hasFiles
        ? (trimmed ? "\n\n" : "") + `📎 ${files.map((f) => f.name).join(", ")}`
        : "";
      const userMsg: Message = {
        id: `u-${now}`,
        role: "user",
        content: trimmed + fileNote,
        kind: null,
        createdAt: new Date(now).toISOString(),
      };

      // Set the polling gate SYNCHRONOUSLY. setIsReplying(true) below only
      // updates the ref after React commits the next render — too late for a
      // poll that fires in the same tick. The ref check in the poller looks
      // at this immediately.
      isReplyingRef.current = true;

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setFiles([]);
      setIsReplying(true);
      setRequestStartedAt(now);
      // Fresh turn: start on the default thinking animation; the stream's
      // phase frames swap it as the assistant reasons / searches / drafts.
      setThinkingState(DEFAULT_THINKING_STATE);

      // Preview mode: keep the mock setTimeout so design iteration via
      // ?state=running keeps working without an orchestrator round-trip.
      if (previewMode) {
        const turn = messages.filter((m) => m.role === "user").length;
        replyTimerRef.current = setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              content:
                mockReplies[turn % mockReplies.length] ?? mockReplies[0] ?? "",
              kind: null,
              createdAt: new Date().toISOString(),
            },
          ]);
          isReplyingRef.current = false;
          setIsReplying(false);
        }, 1200);
        return;
      }

      // Real Hermes round-trip via Sokosumi's server-side proxy. Core
      // reconstructs the full conversation from the persisted DB history; we
      // only send the new user turn + any attached files (encoded as data URLs).
      const controller = new AbortController();
      abortRef.current = controller;
      const filesToSend = files;

      void streamChatTurn({
        trimmed,
        filesToSend,
        turnStartedAt: now,
        controller,
        t,
        onRefresh,
        onRequireSubscription,
        setMessages,
        setIsReplying,
        setProgressChips,
        setThinkingState,
        setReasoning,
        setStreamingId,
        setRequestStartedAt,
        setDurations,
        setStepsByKey,
        turnStepsRef,
        streamingAssistantIdRef,
        reasoningTimerRef,
        reasoningClearAtRef,
        isReplyingRef,
        abortRef,
      });
    },
    [
      files,
      hasAssistantPlanCoverage,
      isReplying,
      messages,
      mockReplies,
      onRefresh,
      onRequireSubscription,
      previewMode,
      setFiles,
      setInput,
      setMessages,
      t,
    ],
  );

  const stop = useCallback(() => {
    if (replyTimerRef.current) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
    const abortedPartialId = streamingAssistantIdRef.current;
    streamingAssistantIdRef.current = null;
    if (abortedPartialId) {
      setMessages((prev) => prev.filter((m) => m.id !== abortedPartialId));
      setStreamingId(null);
      setProgressChips([]);
      if (reasoningTimerRef.current) {
        clearTimeout(reasoningTimerRef.current);
        reasoningTimerRef.current = null;
      }
      reasoningClearAtRef.current = 0;
      setReasoning(null);
      setRequestStartedAt(null);
    }
    abortRef.current?.abort();
    abortRef.current = null;
    // Clear the polling gate synchronously (same pattern as sendMessage setting
    // true) so the inbox poller is not blocked until the next React commit.
    isReplyingRef.current = false;
    setIsReplying(false);
  }, [setMessages]);

  return {
    isReplying,
    isReplyingRef,
    progressChips,
    thinkingState,
    reasoning,
    streamingId,
    requestStartedAt,
    durations,
    stepsByKey,
    sendMessage,
    stop,
  };
}
