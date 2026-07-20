import { toast } from "sonner";

import { listHermesMessagesAction } from "@/lib/actions/hermes";
import { mergeHermesMessageLists } from "@/lib/hermes/merge-persisted-messages";
import {
  deltaContentFrom,
  type HermesStatusEvent,
  parseHermesStatus,
  readSseStream,
} from "@/lib/hermes/sse";

import { HERMES_STREAMING_ENABLED, REASONING_MIN_MS } from "./constants";
import {
  clientMimeForHermesUpload,
  durationKey,
  fileToDataUrl,
  hasSameMessageIds,
  persistedToMessages,
} from "./message-helpers";
import type { ChatApiResponse, Message, ProgressStep } from "./types";

interface StreamChatTurnOptions {
  trimmed: string;
  filesToSend: File[];
  turnStartedAt: number;
  controller: AbortController;
  t: (key: string, values?: Record<string, string | number>) => string;
  onRefresh?: () => void | Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsReplying: React.Dispatch<React.SetStateAction<boolean>>;
  setProgressChips: React.Dispatch<React.SetStateAction<ProgressStep[]>>;
  setReasoning: React.Dispatch<React.SetStateAction<string | null>>;
  setStreamingId: React.Dispatch<React.SetStateAction<string | null>>;
  setRequestStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setDurations: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setStepsByKey: React.Dispatch<
    React.SetStateAction<Map<string, ProgressStep[]>>
  >;
  turnStepsRef: React.RefObject<ProgressStep[]>;
  streamingAssistantIdRef: React.RefObject<string | null>;
  reasoningTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  reasoningClearAtRef: React.RefObject<number>;
  isReplyingRef: React.RefObject<boolean>;
  abortRef: React.RefObject<AbortController | null>;
}

export async function streamChatTurn({
  trimmed,
  filesToSend,
  turnStartedAt,
  controller,
  t,
  onRefresh,
  setMessages,
  setIsReplying,
  setProgressChips,
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
}: StreamChatTurnOptions): Promise<void> {
  try {
    const filePayloads = await Promise.all(
      filesToSend.map(async (f) => {
        const dataUrl = await fileToDataUrl(f);
        return {
          name: f.name,
          type: clientMimeForHermesUpload(f, dataUrl),
          dataUrl,
        };
      }),
    );

    const res = await fetch("/api/personal-assistant/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(HERMES_STREAMING_ENABLED ? { "X-Hermes-Progress": "1" } : {}),
      },
      body: JSON.stringify({
        content: trimmed,
        files: filePayloads.length > 0 ? filePayloads : undefined,
        ...(HERMES_STREAMING_ENABLED ? { stream: true } : {}),
      }),
      signal: controller.signal,
    });

    if (controller.signal.aborted) return;

    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as ChatApiResponse;
      toast.error(
        body.data?.status === "provisioning"
          ? t("errors.warmingUp")
          : (body.message ?? t("errors.notReady")),
      );
      setIsReplying(false);
      return;
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ChatApiResponse;
      toast.error(body.message ?? t("errors.apiError", { status: res.status }));
      setIsReplying(false);
      return;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (res.body && contentType.includes("text/event-stream")) {
      // Streaming path: render `delta.content` incrementally and show
      // `hermes.status` frames as ephemeral progress chips. The parser
      // branches on the SSE `event:` field so status frames never reach
      // the chat-chunk handler.
      const assistantId = `a-${Date.now()}`;
      streamingAssistantIdRef.current = assistantId;
      let acc = "";
      let inserted = false;
      setProgressChips([]);
      turnStepsRef.current = [];
      // Reasoning beats stay on screen ≥ REASONING_MIN_MS so they don't
      // vanish in a blink when the next phase arrives quickly.
      if (reasoningTimerRef.current) {
        clearTimeout(reasoningTimerRef.current);
        reasoningTimerRef.current = null;
      }
      reasoningClearAtRef.current = 0;
      setReasoning(null);
      const showReasoning = (next: string | null) => {
        if (reasoningTimerRef.current) {
          clearTimeout(reasoningTimerRef.current);
          reasoningTimerRef.current = null;
        }
        const apply = () => {
          setReasoning(next);
          reasoningClearAtRef.current = next
            ? Date.now() + REASONING_MIN_MS
            : 0;
        };
        const now = Date.now();
        if (now >= reasoningClearAtRef.current) {
          apply();
        } else {
          reasoningTimerRef.current = setTimeout(
            apply,
            reasoningClearAtRef.current - now,
          );
        }
      };

      // Live chips show tool steps only; reasoning beats live in the
      // trace (turnStepsRef) for the disclosure + the transient line.
      const toolChips = () =>
        turnStepsRef.current.filter((s) => s.kind !== "reasoning");

      const applyStatus = (status: HermesStatusEvent) => {
        if (status.phase === "reasoning") {
          showReasoning(status.detail ?? null);
          if (status.detail) {
            turnStepsRef.current = [
              ...turnStepsRef.current,
              { kind: "reasoning", label: status.detail },
            ];
          }
          return;
        }
        // Any non-reasoning phase supersedes the transient reasoning line.
        showReasoning(null);
        if (status.phase === "answering") {
          setProgressChips([]);
          return;
        }
        if (status.phase === "tool" && status.label) {
          turnStepsRef.current = [
            ...turnStepsRef.current,
            {
              kind: "tool",
              id: status.id,
              label: status.label,
              detail: status.detail,
              done: false,
            },
          ];
          setProgressChips(toolChips());
          return;
        }
        if (status.phase === "tool_done") {
          // Complete the matching tool chip (by tool_call_id, else the
          // most recent still-running one). tool_done.detail is a raw
          // truncated result — we ignore it and keep the tool's subtitle.
          const steps = turnStepsRef.current;
          let idx = status.id
            ? steps.findIndex(
                (s) => s.kind === "tool" && s.id === status.id && !s.done,
              )
            : -1;
          if (idx === -1) {
            idx = steps.findLastIndex((s) => s.kind === "tool" && !s.done);
          }
          if (idx !== -1) {
            turnStepsRef.current = steps.map((s, i) =>
              i === idx ? { ...s, done: true } : s,
            );
            setProgressChips(toolChips());
          }
          return;
        }
        // `thinking` / `working` are covered by the typing indicator.
      };

      for await (const ev of readSseStream(res.body)) {
        if (controller.signal.aborted) break;
        if (ev.event === "hermes.status") {
          const status = parseHermesStatus(ev.data);
          if (status) applyStatus(status);
          continue;
        }
        const delta = deltaContentFrom(ev.data);
        if (delta) {
          acc += delta;
          if (!inserted) {
            inserted = true;
            setProgressChips([]);
            setStreamingId(assistantId);
            setMessages((prev) => [
              ...prev,
              {
                id: assistantId,
                role: "assistant",
                content: acc,
                kind: null,
                createdAt: new Date().toISOString(),
              },
            ]);
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: acc } : m,
              ),
            );
          }
        }
      }

      if (acc.trim()) {
        const key = durationKey(acc);
        setDurations((prev) =>
          new Map(prev).set(key, Date.now() - turnStartedAt),
        );
        if (turnStepsRef.current.length) {
          const steps = turnStepsRef.current;
          setStepsByKey((prev) => new Map(prev).set(key, steps));
        }
      } else if (!controller.signal.aborted) {
        toast.error(t("errors.emptyResponse"));
      }
    } else {
      // Fallback: server returned buffered JSON (streaming not enabled).
      const body = (await res.json()) as ChatApiResponse;
      const reply = body.data?.message?.content ?? "";
      if (!reply) {
        toast.error(t("errors.emptyResponse"));
        setIsReplying(false);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: reply,
          kind: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setDurations((prev) =>
        new Map(prev).set(durationKey(reply), Date.now() - turnStartedAt),
      );
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    toast.error(t("errors.unreachable"));
  } finally {
    if (abortRef.current === controller) abortRef.current = null;
    // Clear the polling gate synchronously (same pattern as stop()) so the
    // inbox poller is not blocked until the next React commit.
    isReplyingRef.current = false;
    setIsReplying(false);
    setProgressChips([]);
    if (reasoningTimerRef.current) {
      clearTimeout(reasoningTimerRef.current);
      reasoningTimerRef.current = null;
    }
    reasoningClearAtRef.current = 0;
    setReasoning(null);
    setStreamingId(null);
    setRequestStartedAt(null);

    const abortedPartialId = controller.signal.aborted
      ? streamingAssistantIdRef.current
      : null;
    streamingAssistantIdRef.current = null;

    // This runs inside a `void`-discarded async IIFE, so a throw here
    // (e.g. the session expired mid-stream and the server action rejects
    // with UnAuthenticatedError) would become an unhandled rejection —
    // the outer try/catch does not cover the finally. Guard it: the
    // synchronous cleanup above already settled the UI, so a failed
    // post-turn refresh just skips silently.
    try {
      const result = await listHermesMessagesAction({});
      if (result.ok) {
        const next = persistedToMessages(result.data);
        setMessages((prev) => {
          const base =
            abortedPartialId !== null
              ? prev.filter((m) => m.id !== abortedPartialId)
              : prev;
          const merged = mergeHermesMessageLists(base, next);
          return hasSameMessageIds(base, merged) ? base : merged;
        });
      }
      // Refresh the instance so any medium-autonomy gate the model queued
      // during this turn (it lives on instance.pendingConfirmations, NOT
      // in the message stream) surfaces immediately — otherwise the
      // approval box stays invisible until the next 30s background refresh.
      await onRefresh?.();
    } catch {
      // Post-turn refresh failed (auth/network); UI is already clean.
    }
  }
}
