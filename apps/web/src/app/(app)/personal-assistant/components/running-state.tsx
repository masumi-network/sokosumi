"use client";

import { ArrowDown, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import SettingsPanel from "@/app/personal-assistant/components/settings-panel";
import {
  listHermesMessagesAction,
  markHermesInboxSeenAction,
} from "@/lib/actions/hermes";
import {
  HERMES_CONFIRMATION_CARD_KIND,
  parseConfirmationCardMessage,
} from "@/lib/hermes/confirmation-card-message";
import { mergeHermesMessageLists } from "@/lib/hermes/merge-persisted-messages";
import { personalityToOrbMotion } from "@/lib/hermes/personality-orb";
import {
  deltaContentFrom,
  type HermesStatusEvent,
  parseHermesStatus,
  readSseStream,
} from "@/lib/hermes/sse";
import type {
  HermesInstancePublic,
  HermesOrganizationOption,
  HermesPendingConfirmation,
  HermesPersistedMessage,
} from "@/lib/hermes/types";
import { orderedMessageList } from "@/lib/intl/ordered-message-list";
import AutonomyPanel from "./autonomy-panel";
import {
  AssistantMotionContext,
  AssistantSeedContext,
} from "./running-state/assistant-context";
import { Composer } from "./running-state/composer";
import { ConfirmationCard } from "./running-state/confirmation-card";
import { buildMockPendingConfirmations } from "./running-state/confirmation-mock";
import {
  HERMES_STREAMING_ENABLED,
  POLL_INTERVAL_MS,
  REASONING_MIN_MS,
} from "./running-state/constants";
import { AutonomyChip, IntegrationsChip } from "./running-state/header-chips";
import {
  clientMimeForHermesUpload,
  durationKey,
  fileToDataUrl,
  hasSameMessageIds,
  persistedToMessage,
  persistedToMessages,
} from "./running-state/message-helpers";
import { MessageRow } from "./running-state/message-row";
import {
  AssistantTyping,
  ProgressChips,
  ReasoningLine,
} from "./running-state/progress-ui";
import type {
  ChatApiResponse,
  Message,
  ProgressStep,
  ResolvedConfirmationEntry,
  TimelineEntry,
} from "./running-state/types";
import { WelcomeBlock } from "./running-state/welcome-block";

export interface RunningStateProps {
  userName?: string | null;
  userImageUrl?: string | null;
  /** The assistant's generative orb seed — its avatar in every message. */
  avatarSeed: string;
  /** Base seed for the curated orb palette (the user's id) — drives the
   * colour re-picker in Settings. */
  orbBaseSeed: string;
  instance: HermesInstancePublic | null;
  previewMode: boolean;
  initialMessages?: HermesPersistedMessage[];
  /** Orgs the user is a member of (for the confirmation-card dropdown). */
  organizations?: HermesOrganizationOption[];
  /** Active org from the session — pre-selected in the dropdown. */
  activeOrganizationId?: string | null;
  /** Paid coverage for chat / confirmations / settings mutations. */
  hasActiveSubscription?: boolean;
  /** Opens the subscription wall when an unpaid user tries to use PA. */
  onRequireSubscription?: () => void;
  onDestroy: () => Promise<void> | void;
  /** Re-pull the instance from the orchestrator. SettingsPanel calls this
   * after mutations so the integrations chip / autonomy badge don't drift. */
  onRefresh?: () => void | Promise<void>;
}

export default function RunningState({
  userName,
  userImageUrl,
  avatarSeed,
  orbBaseSeed,
  instance,
  previewMode,
  initialMessages,
  organizations = [],
  activeOrganizationId = null,
  hasActiveSubscription = true,
  onRequireSubscription,
  onDestroy,
  onRefresh,
}: RunningStateProps) {
  const searchParams = useSearchParams();
  const t = useTranslations("App.Hermes.Running");
  const mockReplies = orderedMessageList(
    t.raw("mockReplies") as Record<string, string>,
  );

  const [messages, setMessages] = useState<Message[]>(() =>
    persistedToMessages(initialMessages ?? []),
  );
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isReplying, setIsReplying] = useState(false);
  // Ephemeral live-progress chips from `event: hermes.status` frames (tool
  // phases). Cleared the moment the answer starts streaming and on turn end.
  const [progressChips, setProgressChips] = useState<ProgressStep[]>([]);
  // Transient chain-of-thought snippet from `reasoning` frames; superseded by
  // the next phase. Advisory + ephemeral — never persisted.
  const [reasoning, setReasoning] = useState<string | null>(null);
  // Id of the assistant message currently being streamed in, or null. While
  // set, the typing indicator is hidden (the growing message is the feedback).
  const [streamingId, setStreamingId] = useState<string | null>(null);
  // Wall-clock start of the in-flight turn, for the elapsed-time indicator.
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  // Per-turn total durations (ms), keyed by durationKey(content) so the
  // "Answered in Ns" stamp survives the post-turn DB re-sync.
  const [durations, setDurations] = useState<Map<string, number>>(
    () => new Map(),
  );
  // Whether the scroller is pinned to the bottom (drives the jump-to-latest pill).
  const [atBottom, setAtBottom] = useState(true);
  // Tool/progress steps captured per turn, keyed like durations so the
  // collapsible "steps" disclosure survives the post-turn DB re-sync.
  const [stepsByKey, setStepsByKey] = useState<Map<string, ProgressStep[]>>(
    () => new Map(),
  );
  // Authoritative step list for the in-flight turn (the progressChips state is
  // only the live render; this ref is what we read at completion).
  const turnStepsRef = useRef<ProgressStep[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autonomyOpen, setAutonomyOpen] = useState(false);
  // Dev-only mock confirmations injected via `?state=running&mock=confirmation`
  // (plus optional `&coworkerId=…&coworkerName=…`). Lets you eyeball the
  // ConfirmationCard chips without waiting for Hermes to actually emit a
  // sokosumi_create_task call. Captured once on mount; never repolls.
  const [mockConfirmations] = useState<HermesPendingConfirmation[]>(() => {
    if (!previewMode) return [];
    return buildMockPendingConfirmations(searchParams);
  });
  // Confirmations the user has already resolved this session. We snapshot
  // the full confirmation + the resolution (approved vs rejected + the org
  // they picked, when relevant) so the card can stay in the chat as a
  // read-only audit trail even after the orchestrator drops it from
  // `pendingConfirmations`. The chronological order of resolution is
  // what we render — Map iteration order preserves insertion.
  const [resolvedConfirmations, setResolvedConfirmations] = useState<
    Map<string, ResolvedConfirmationEntry>
  >(() => new Map());

  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Optimistic assistant id for the in-flight streamed turn — used to drop a
  // partial bubble when the user hits Stop (Core still captures the full reply).
  const streamingAssistantIdRef = useRef<string | null>(null);
  const reasoningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasoningClearAtRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const isReplyingRef = useRef(false);

  useEffect(() => {
    isReplyingRef.current = isReplying;
  }, [isReplying]);

  useEffect(() => {
    if (!initialMessages) return;
    const serverMessages = persistedToMessages(initialMessages);
    setMessages((prev) => {
      const merged = mergeHermesMessageLists(prev, serverMessages);
      return hasSameMessageIds(prev, merged) ? prev : merged;
    });
  }, [initialMessages]);

  useEffect(() => {
    return () => {
      if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
      if (reasoningTimerRef.current) clearTimeout(reasoningTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Browser-side polling for outbox messages (scheduled tasks, reminders,
  // agent-initiated follow-ups). Server cron drains the orchestrator into
  // our DB; this loop just keeps the open tab in sync so the user doesn't
  // have to reload. Paused while a chat turn is mid-flight (so optimistic
  // bubbles don't flicker) and while the tab is hidden.
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (isReplyingRef.current) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const result = await listHermesMessagesAction({});
      if (cancelled || !result.ok) return;
      // Re-check after the await: if the user kicked off a chat turn while we
      // were fetching, the server's snapshot is now stale relative to our
      // optimistic local state. Discarding here prevents clobbering the
      // user's just-typed bubble. (Same race fixed in sendMessage by setting
      // isReplyingRef synchronously before any awaits.)
      if (isReplyingRef.current) return;
      const next = result.data
        .map(persistedToMessage)
        .filter((m): m is Message => m !== null);

      // Mark inbox as seen up to the latest message we have. The user is
      // actively viewing the chat, so anything we just rendered should clear
      // the sidebar badge. Best-effort — failures don't break rendering.
      const latest = next[next.length - 1];
      if (latest) {
        void markHermesInboxSeenAction({ asOfIso: latest.createdAt });
      }

      setMessages((prev) => {
        const merged = mergeHermesMessageLists(prev, next);
        // Cheap shallow check to avoid unnecessary rerenders + scroll jitter.
        if (hasSameMessageIds(prev, merged)) return prev;
        return merged;
      });
    };

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [previewMode]);

  // Mark inbox as seen when the user lands on /personal-assistant — clears the sidebar
  // unread badge for whatever was waiting on initial load.
  useEffect(() => {
    if (previewMode) return;
    void markHermesInboxSeenAction({});
  }, [previewMode]);

  // Auto-scroll to bottom on new messages (or when typing indicator flips on).
  // Two exceptions:
  //  1. First-ever message lands (0 → 1) — that's the welcome, user should
  //     start reading from the top of it, not jumped to the bottom.
  //  2. Initial mount with history already populated — `requestAnimationFrame`
  //     still scrolls so returning users land at the latest message, which is
  //     the standard chat behaviour.
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    if (prevLen === 0 && messages.length === 1) return;

    const el = scrollerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages.length, isReplying]);

  // Follow the answer as it streams in — but only if the user is already near
  // the bottom, so scrolling up to re-read isn't hijacked mid-stream.
  const streamingContentLength = streamingId
    ? (messages.find((m) => m.id === streamingId)?.content.length ?? 0)
    : 0;
  useEffect(() => {
    if (!streamingId) return;
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [streamingId, streamingContentLength]);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      const hasFiles = files.length > 0;
      if ((!trimmed && !hasFiles) || isReplying) return;

      if (!previewMode && !hasActiveSubscription) {
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

      void (async () => {
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
            const body = (await res
              .json()
              .catch(() => ({}))) as ChatApiResponse;
            toast.error(
              body.data?.status === "provisioning"
                ? t("errors.warmingUp")
                : (body.message ?? t("errors.notReady")),
            );
            setIsReplying(false);
            return;
          }

          if (!res.ok) {
            const body = (await res
              .json()
              .catch(() => ({}))) as ChatApiResponse;
            toast.error(
              body.message ?? t("errors.apiError", { status: res.status }),
            );
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
                  idx = steps.findLastIndex(
                    (s) => s.kind === "tool" && !s.done,
                  );
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
              setDurations((prev) => new Map(prev).set(key, Date.now() - now));
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
              new Map(prev).set(durationKey(reply), Date.now() - now),
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
      })();
    },
    [
      files,
      hasActiveSubscription,
      isReplying,
      messages,
      mockReplies,
      onRefresh,
      onRequireSubscription,
      previewMode,
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
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage],
  );

  // One-shot inbox sync (same fetch+merge as the poll). Used to surface the
  // orchestrator's post-approval result quickly instead of waiting for the
  // next regular 5s tick.
  const syncMessages = useCallback(async () => {
    if (isReplyingRef.current) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const result = await listHermesMessagesAction({});
    if (!result.ok || isReplyingRef.current) return;
    const next = result.data
      .map(persistedToMessage)
      .filter((m): m is Message => m !== null);
    const latest = next[next.length - 1];
    if (latest) {
      void markHermesInboxSeenAction({ asOfIso: latest.createdAt });
    }
    setMessages((prev) => {
      const merged = mergeHermesMessageLists(prev, next);
      return hasSameMessageIds(prev, merged) ? prev : merged;
    });
  }, []);

  const firstName = userName?.split(" ")[0] ?? null;
  // Confirmations already resolved somewhere durable — e.g. approved in
  // another tab or device. Their persisted audit cards are in `messages`,
  // while a lagging instance snapshot may still list the same id as
  // pending; without this set the user would see an interactive pending
  // card AND the resolved card for the same confirmation at once.
  const persistedResolvedIds = new Set(
    messages
      .filter((m) => m.kind === HERMES_CONFIRMATION_CARD_KIND)
      .map((m) => parseConfirmationCardMessage(m.content)?.confirmation.id)
      .filter((id): id is string => Boolean(id)),
  );
  // Active (still-pending) cards — interactive. We exclude anything the
  // user has already resolved this session so the optimistic transition
  // to "resolved" doesn't briefly render the same id twice while the
  // orchestrator catches up.
  const pendingCards = [
    ...(instance?.pendingConfirmations ?? []),
    ...mockConfirmations,
  ].filter(
    (c) => !resolvedConfirmations.has(c.id) && !persistedResolvedIds.has(c.id),
  );
  const resolvedCards = Array.from(resolvedConfirmations.values());
  // Interleave resolved confirmation cards into the message timeline by when
  // they were resolved, so they sit in chronological order (and move up as the
  // chat continues) instead of being pinned below newer messages.
  //
  // We deliberately do NOT render a task card here on approval. The task is
  // created by the agent after approval; the real `/tasks/:id` card arrives as
  // a `confirmation_resolved` message (rendered by `MessageRow`). The resolved
  // confirmation card itself shows a "creating in the background" note so the
  // user knows what to expect.
  const timeline: TimelineEntry[] = [
    ...messages.flatMap((message): TimelineEntry[] => {
      const ts = new Date(message.createdAt).getTime() || 0;
      // Persisted resolved-confirmation cards (written by Core at
      // approve/reject time) render as read-only ConfirmationCards, not
      // prose. While this tab's own resolved card is still in memory it
      // owns the slot — skip the persisted copy to avoid a duplicate;
      // after a reload only the persisted card exists. Unparseable rows
      // are dropped rather than surfacing raw JSON in the chat.
      if (message.kind === HERMES_CONFIRMATION_CARD_KIND) {
        const parsed = parseConfirmationCardMessage(message.content);
        if (!parsed || resolvedConfirmations.has(parsed.confirmation.id)) {
          return [];
        }
        return [
          {
            kind: "resolved" as const,
            ts,
            key: message.id,
            entry: {
              confirmation: parsed.confirmation,
              resolution: parsed.resolution,
              timelineTs: ts,
            },
          },
        ];
      }
      return [{ kind: "message" as const, ts, key: message.id, message }];
    }),
    ...resolvedCards.map((entry) => ({
      kind: "resolved" as const,
      // `timelineTs` was snapshotted at approval as "just past everything
      // visible right now", so the card sits after the message that raised
      // it and before the orchestrator's `confirmation_resolved` reply —
      // regardless of client/server clock skew or the optimistic→persisted
      // timestamp rewrite of surrounding messages.
      ts: entry.timelineTs,
      key: `resolved-${entry.confirmation.id}`,
      entry,
    })),
  ].sort((a, b) => a.ts - b.ts);
  const isEmpty =
    messages.length === 0 &&
    pendingCards.length === 0 &&
    resolvedCards.length === 0;
  // The chat orb mirrors the chosen personality (livelier + a resting smile for
  // playful/warm), using the exact mapping the onboarding hero uses.
  const orbMotion = personalityToOrbMotion(instance?.personality);

  return (
    <AssistantSeedContext.Provider value={avatarSeed}>
      <AssistantMotionContext.Provider value={orbMotion}>
        <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg">
          {/* Floating top-right controls — Autonomy (level + scheduled
          tasks) and Settings (identity, integrations, danger zone). */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
            <AutonomyChip onClick={() => setAutonomyOpen(true)} />
            <IntegrationsChip
              integrations={instance?.integrations ?? []}
              onClick={() => setSettingsOpen(true)}
            />
          </div>

          {/* Scrollable content area — flex-grows to fill remaining height,
          composer below sits at natural height. No more manual bottom
          offset to keep in sync with the composer's height. */}
          <div
            ref={scrollerRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              setAtBottom(
                el.scrollHeight - el.scrollTop - el.clientHeight < 80,
              );
            }}
            className="scrollbar-none min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {isEmpty ? (
              <WelcomeBlock firstName={firstName} />
            ) : (
              <div className="flex flex-col items-center pt-12 pb-6 md:pt-8">
                <div className="flex w-full max-w-4xl flex-col gap-1">
                  {timeline.map((item) =>
                    item.kind === "message" ? (
                      <MessageRow
                        key={item.key}
                        message={item.message}
                        userImageUrl={userImageUrl}
                        userName={userName}
                        isStreaming={item.message.id === streamingId}
                        durationMs={
                          durations.get(durationKey(item.message.content)) ??
                          item.message.durationMs
                        }
                        steps={
                          stepsByKey.get(durationKey(item.message.content)) ??
                          item.message.steps
                        }
                        onSelectSuggestion={(prompt) => {
                          setInput(prompt);
                          composerRef.current?.focus();
                        }}
                      />
                    ) : (
                      <ConfirmationCard
                        key={item.key}
                        confirmation={item.entry.confirmation}
                        organizations={organizations}
                        activeOrganizationId={activeOrganizationId}
                        resolution={item.entry.resolution}
                        hasActiveSubscription={hasActiveSubscription}
                        onRequireSubscription={onRequireSubscription}
                        onResolved={() => {}}
                      />
                    ),
                  )}
                  {isReplying && !streamingId ? (
                    <>
                      {progressChips.length > 0 ? (
                        <ProgressChips
                          chips={progressChips}
                          startedAt={requestStartedAt}
                        />
                      ) : (
                        <AssistantTyping startedAt={requestStartedAt} />
                      )}
                      {reasoning ? <ReasoningLine snippet={reasoning} /> : null}
                    </>
                  ) : null}
                  {pendingCards.map((confirmation) => (
                    <ConfirmationCard
                      key={confirmation.id}
                      confirmation={confirmation}
                      organizations={organizations}
                      activeOrganizationId={activeOrganizationId}
                      resolution={null}
                      hasActiveSubscription={hasActiveSubscription}
                      onRequireSubscription={onRequireSubscription}
                      onResolved={(id, resolution, resolvedConfirmation) => {
                        // Anchor the card just past the newest thing on screen
                        // at this moment — after the message that raised the
                        // gate, before the orchestrator's reply that follows.
                        // Never trust a single clock: message timestamps mix
                        // optimistic client stamps with server ISO strings.
                        const latestVisibleTs = Math.max(
                          new Date(resolvedConfirmation.createdAt).getTime() ||
                            0,
                          ...messages.map(
                            (m) => new Date(m.createdAt).getTime() || 0,
                          ),
                          ...Array.from(
                            resolvedConfirmations.values(),
                            (e) => e.timelineTs,
                          ),
                        );
                        setResolvedConfirmations((prev) => {
                          if (prev.has(id)) return prev;
                          const next = new Map(prev);
                          next.set(id, {
                            // Use the confirmation the card actually resolved, not
                            // this map closure's capture — a background instance
                            // refresh could have swapped the object for this id
                            // mid-approval, storing stale metadata otherwise.
                            confirmation: resolvedConfirmation,
                            resolution,
                            timelineTs: latestVisibleTs + 1,
                          });
                          return next;
                        });
                        // Poll a few times to surface the orchestrator's result
                        // quickly rather than waiting for the next 5s tick.
                        for (const delay of [1200, 3000, 6000]) {
                          setTimeout(() => void syncMessages(), delay);
                        }
                        // Refresh the instance so the resolved gate drops out of
                        // pendingConfirmations (and any follow-up gate the tool
                        // queued appears) without waiting for the 30s refresh.
                        void onRefresh?.();
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Composer (natural height, anchored at bottom of flex column) */}
          <div className="bg-background relative mx-auto flex w-full shrink-0 flex-col items-center px-4 pt-2 pb-4">
            {/* Soft fade from scroll area into composer */}
            <div
              aria-hidden
              className="from-background pointer-events-none absolute -top-8 right-0 left-0 z-5 h-8 bg-linear-to-t to-transparent"
            />
            {/* Jump-to-latest pill — appears when scrolled up; anchored just
                above the composer (not floating mid-chat). Border + arrow do
                the work; no shadow, matching the rest of the app. */}
            {!atBottom && !isEmpty ? (
              <button
                type="button"
                onClick={() => {
                  const el = scrollerRef.current;
                  if (el) {
                    el.scrollTop = el.scrollHeight;
                    setAtBottom(true);
                  }
                }}
                className="bg-background text-foreground border-border hover:bg-muted/60 hover:border-foreground/30 focus-visible:ring-primary/40 absolute -top-11 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2"
              >
                <ArrowDown aria-hidden className="size-3.5" />
                {t("jumpToLatest")}
              </button>
            ) : null}
            {instance?.transitioning ? (
              <div className="mb-2 w-full max-w-4xl">
                <div className="border-primary/30 bg-primary/5 text-foreground flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm">
                  <Loader2
                    className="text-primary size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  <span>
                    {t("transitioning")}{" "}
                    <span className="text-muted-foreground">
                      {t("transitioningHint")}
                    </span>
                  </span>
                </div>
              </div>
            ) : null}
            <div className="w-full max-w-4xl">
              <Composer
                ref={composerRef}
                input={input}
                setInput={setInput}
                files={files}
                setFiles={setFiles}
                onSubmit={handleSubmit}
                isReplying={isReplying}
                disabled={instance?.transitioning === true}
                onStop={stop}
                placeholder={t("composerPlaceholder")}
                sendLabel={t("send")}
                stopLabel={t("stop")}
                attachLabel={t("attach")}
              />
            </div>
          </div>

          <SettingsPanel
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            previewMode={previewMode}
            integrations={instance?.integrations ?? []}
            lastSokosumiSyncAt={instance?.lastSokosumiSyncAt ?? null}
            lastInboxRefreshAt={instance?.lastInboxRefreshAt ?? null}
            assistantName={instance?.assistantName ?? null}
            avatarSeed={instance?.avatarSeed ?? null}
            orbBaseSeed={orbBaseSeed}
            hasActiveSubscription={hasActiveSubscription}
            onRequireSubscription={onRequireSubscription}
            onDestroy={onDestroy}
            onRefreshInstance={onRefresh}
          />
          <AutonomyPanel
            open={autonomyOpen}
            onOpenChange={setAutonomyOpen}
            previewMode={previewMode}
            autonomyLevel={instance?.autonomyLevel ?? "medium"}
            hasActiveSubscription={hasActiveSubscription}
            onRequireSubscription={onRequireSubscription}
            onRefreshInstance={onRefresh}
          />
        </div>
      </AssistantMotionContext.Provider>
    </AssistantSeedContext.Provider>
  );
}
