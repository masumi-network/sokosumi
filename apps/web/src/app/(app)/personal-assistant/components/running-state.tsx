"use client";

import {
  AlertCircle,
  ArrowDown,
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  Coins,
  Copy,
  Loader2,
  Plug,
  Plus,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import React, {
  createContext,
  type FormEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  applyConfirmationOrgProposalUpdate,
  buildConfirmationApproveOverrideIfChanged,
  buildCurrentConfirmationApproveOrganizationOverride,
  CONFIRMATION_PERSONAL_SCOPE_VALUE,
  isConfirmationOrgAwareTool,
  mergeConfirmationOrgPickerOptions,
  resolveConfirmationOrgPickerValue,
} from "@/app/personal-assistant/components/confirmation-org-picker";
import RotatingMessages from "@/app/personal-assistant/components/rotating-messages";
import SettingsPanel from "@/app/personal-assistant/components/settings-panel";
import { AuroraOrb } from "@/components/aurora-orb";
import { ArrowUpIcon, StopIcon } from "@/components/chat/icons";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/chat/prompt-input";
import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  approveHermesConfirmationAction,
  listHermesMessagesAction,
  markHermesInboxSeenAction,
  rejectHermesConfirmationAction,
} from "@/lib/actions/hermes";
import type { OrbExpression } from "@/lib/aurora-orb";
import {
  type HermesUiMessage,
  mergeHermesMessageLists,
} from "@/lib/hermes/merge-persisted-messages";
import {
  DEFAULT_ORB_MOTION,
  type OrbMotion,
  personalityToOrbMotion,
} from "@/lib/hermes/personality-orb";
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
import { cn } from "@/lib/utils";

/** The committed orb seed — the assistant's avatar across the chat. */
const AssistantSeedContext = createContext<string>("personal-assistant");

/**
 * The orb's personality-driven motion (liveliness + resting eyes), published to
 * the chat avatars the same way the seed is. Defaults to calm/neutral.
 */
const AssistantMotionContext = createContext<OrbMotion>(DEFAULT_ORB_MOTION);

interface RunningStateProps {
  userName?: string | null;
  userImageUrl?: string | null;
  /** The assistant's generative orb seed — its avatar in every message. */
  avatarSeed: string;
  instance: HermesInstancePublic | null;
  previewMode: boolean;
  initialMessages?: HermesPersistedMessage[];
  /** Orgs the user is a member of (for the confirmation-card dropdown). */
  organizations?: HermesOrganizationOption[];
  /** Active org from the session — pre-selected in the dropdown. */
  activeOrganizationId?: string | null;
  onDestroy: () => Promise<void> | void;
  /** Re-pull the instance from the orchestrator. SettingsPanel calls this
   * after mutations so the integrations chip / autonomy badge don't drift. */
  onRefresh?: () => void | Promise<void>;
}

type Message = HermesUiMessage;

const POLL_INTERVAL_MS = 5_000;
/** Minimum time a reasoning beat stays on screen before the next phase can
 * replace/clear it — so beats don't flash by unreadably. */
const REASONING_MIN_MS = 1_000;

/**
 * Opt-in flag for Hermes streaming + live progress. Off by default so the chat
 * keeps using the buffered /chat path until the orchestrator side is verified
 * (it must support `stream: true` + emit `event: hermes.status` frames). Flip
 * `NEXT_PUBLIC_HERMES_STREAMING=1` to enable end-to-end streaming.
 */
const HERMES_STREAMING_ENABLED =
  process.env.NEXT_PUBLIC_HERMES_STREAMING === "1";

function persistedToMessage(m: HermesPersistedMessage): Message | null {
  if (m.role !== "user" && m.role !== "assistant") return null;
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    kind: m.kind,
    steps: m.steps,
    durationMs: m.durationMs,
    createdAt: m.createdAt,
  };
}

function persistedToMessages(messages: HermesPersistedMessage[]): Message[] {
  return messages
    .map(persistedToMessage)
    .filter((m): m is Message => m !== null);
}

function hasSameMessageIds(left: Message[], right: Message[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i]!.id !== right[i]!.id) return false;
  }
  return true;
}

/** Stable-ish key for a turn's duration, surviving the temp→persisted id swap
 * on the post-turn DB re-sync (the content text is unchanged). */
function durationKey(content: string): string {
  return content.trim().slice(0, 80);
}

/** A step in a turn's trace: a `tool` action chip or a `reasoning` beat.
 * Absent `kind` is treated as "tool" (older persisted rows). */
interface ProgressStep {
  kind?: "tool" | "reasoning";
  /** tool_call_id — matches a `tool` frame to its `tool_done`. */
  id?: string;
  /** tool: the action label; reasoning: the chain-of-thought snippet. */
  label: string;
  detail?: string;
  /** Set once the tool's `tool_done` frame arrives (chip completes). */
  done?: boolean;
}

interface ChatApiResponse {
  data?: {
    message?: { role?: string; content?: string };
    status?: string;
  };
  error?: string;
  message?: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("file_read_failed"));
    r.readAsDataURL(file);
  });
}

/** Prefer the data URL MIME when the browser left `File.type` blank. */
function mimeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;,]*);/i.exec(dataUrl);
  if (!match) return null;
  const raw = match[1]!.trim();
  const lower = raw.toLowerCase();
  if (lower === "" || lower === "application/octet-stream") return null;
  return lower;
}

function clientMimeForHermesUpload(file: File, dataUrl: string): string {
  if (file.type.trim() !== "") return file.type;
  return mimeFromDataUrl(dataUrl) ?? "application/octet-stream";
}

export default function RunningState({
  userName,
  userImageUrl,
  avatarSeed,
  instance,
  previewMode,
  initialMessages,
  organizations = [],
  activeOrganizationId = null,
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

  // Mark inbox as seen when the user lands on /hermes — clears the sidebar
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
    [files, isReplying, messages, mockReplies, onRefresh, previewMode, t],
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
  // Active (still-pending) cards — interactive. We exclude anything the
  // user has already resolved this session so the optimistic transition
  // to "resolved" doesn't briefly render the same id twice while the
  // orchestrator catches up.
  const pendingCards = [
    ...(instance?.pendingConfirmations ?? []),
    ...mockConfirmations,
  ].filter((c) => !resolvedConfirmations.has(c.id));
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
  const timeline: Array<
    | { kind: "message"; ts: number; key: string; message: Message }
    | {
        kind: "resolved";
        ts: number;
        key: string;
        entry: ResolvedConfirmationEntry;
      }
  > = [
    ...messages.map((message) => ({
      kind: "message" as const,
      ts: new Date(message.createdAt).getTime() || 0,
      key: message.id,
      message,
    })),
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
          {/* Floating top-right control — the integrations chip doubles as the
          entry point into Settings (covers autonomy, schedules, danger zone)
          so we don't need a separate gear button competing for attention. */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
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

          {/* Jump-to-latest pill — appears when scrolled up; snaps to the live answer. */}
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
              className="bg-background text-foreground border-border hover:bg-muted/60 focus-visible:ring-primary/40 absolute bottom-28 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm outline-none transition-colors focus-visible:ring-2"
            >
              <ArrowDown aria-hidden className="size-3.5" />
              {t("jumpToLatest")}
            </button>
          ) : null}

          {/* Composer (natural height, anchored at bottom of flex column) */}
          <div className="bg-background relative mx-auto flex w-full shrink-0 flex-col items-center px-4 pt-2 pb-4">
            {/* Soft fade from scroll area into composer */}
            <div
              aria-hidden
              className="from-background pointer-events-none absolute -top-8 right-0 left-0 z-5 h-8 bg-linear-to-t to-transparent"
            />
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
            autonomyLevel={instance?.autonomyLevel ?? "medium"}
            lastSokosumiSyncAt={instance?.lastSokosumiSyncAt ?? null}
            lastInboxRefreshAt={instance?.lastInboxRefreshAt ?? null}
            assistantName={instance?.assistantName ?? null}
            onDestroy={onDestroy}
            onRefreshInstance={onRefresh}
          />
        </div>
      </AssistantMotionContext.Provider>
    </AssistantSeedContext.Provider>
  );
}

function WelcomeBlock({ firstName }: { firstName: string | null }) {
  const t = useTranslations("App.Hermes.Running");
  const greeting = firstName
    ? `${t("emptyTitle")}, ${firstName}`
    : t("emptyTitle");

  // The orchestrator's welcome typically lands within ~2s of arriving here
  // (it's bundled into the instance "ready" response). Showing the empty
  // greeting immediately and then replacing it with the real welcome reads
  // as a glitch — hold the empty state for a moment so it only renders if
  // there's a true cold start with no welcome incoming.
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 2_500);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;

  return (
    <div className="mt-[-80px] flex h-full flex-col items-center justify-center px-6">
      <div className="mx-auto w-full max-w-xl text-center">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight md:text-4xl">
          {greeting}
        </h1>
        <p className="text-muted-foreground mt-4 text-base leading-relaxed">
          {t("emptyHint")}
        </p>
      </div>
    </div>
  );
}

/**
 * Pull suggested prompts out of a welcome-style message. The orchestrator
 * formats them as markdown list items of the form:
 *   - **Label** — "Quoted prompt to send to Hermes."
 * We extract the quoted text and render it as click-to-send chips below
 * the message. Best-effort: returns [] if no quoted strings are found.
 */
function extractSuggestedPrompts(content: string): string[] {
  const prompts: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("-") && !line.startsWith("*")) continue;
    // Match the FIRST `"..."` on the line. Use a non-greedy match to handle
    // multiple quoted segments on one line gracefully (we only chip the first).
    const match = line.match(/["“]([^"“”]{8,200})["”]/);
    if (match?.[1]) prompts.push(match[1].trim());
  }
  // De-dup while preserving order, cap at 6 to keep the strip readable.
  return Array.from(new Set(prompts)).slice(0, 6);
}

function MessageRow({
  message,
  userImageUrl,
  userName,
  isStreaming = false,
  durationMs,
  steps,
  onSelectSuggestion,
}: {
  message: Message;
  userImageUrl?: string | null;
  userName?: string | null;
  isStreaming?: boolean;
  durationMs?: number;
  steps?: ProgressStep[];
  onSelectSuggestion?: (prompt: string) => void;
}) {
  const t = useTranslations("App.Hermes.Running");
  const formatter = useFormatter();
  const isUser = message.role === "user";
  const createdAt = new Date(message.createdAt);
  const timestamp = formatter.dateTime(createdAt, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isUser) {
    return (
      <div className="group/message flex w-full justify-end gap-3 px-4 py-0.5">
        <div className="flex max-w-[70%] flex-col items-end gap-0.5">
          <div className="bg-muted-foreground/10 text-foreground min-h-6 rounded-lg px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
            {message.content}
          </div>
          <time
            dateTime={message.createdAt}
            className="text-tertiary-foreground px-1 text-[10px] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100"
          >
            {timestamp}
          </time>
        </div>
        <Avatar className="size-8 shrink-0">
          {userImageUrl ? (
            <AvatarImage
              src={userImageUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
            {userName?.trim() ? userName.trim().charAt(0).toUpperCase() : "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  const chip = describeOutboxKind(message.kind, (key) => t(key));
  // Only the orchestrator's intro/welcome messages carry suggested prompts.
  const showSuggestions =
    onSelectSuggestion !== undefined &&
    (message.kind === "research_intro" ||
      message.kind === "welcome" ||
      message.kind === "returning");
  const suggestions = showSuggestions
    ? extractSuggestedPrompts(message.content)
    : [];

  // Detect orchestrator-pushed "confirmation_resolved" messages with a
  // sokosumi_create_task payload and split them into prose + task card so
  // the user doesn't have to read raw JSON in chat.
  const parsedConfirmation =
    message.kind === "confirmation_resolved"
      ? parseConfirmationResolved(message.content, {
          resolvedFallback: t("confirmation.resolvedFallback"),
          coworkerFallback: t("confirmation.taskCard.defaultCoworker"),
          organizationFallback: t("confirmation.taskCard.defaultOrganization"),
        })
      : null;

  return (
    <div className="group/message flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      <AssistantAvatar accent={Boolean(chip)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {chip ? (
          <span className="border-border/60 text-tertiary-foreground bg-muted/40 inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium uppercase tracking-wider">
            {chip.label}
          </span>
        ) : null}
        {steps && steps.length > 0 ? (
          <MessageSteps
            steps={steps}
            countLabel={
              steps.length === 1 && steps[0]!.kind !== "reasoning"
                ? steps[0]!.label
                : t("toolSteps", { count: steps.length })
            }
          />
        ) : null}
        {parsedConfirmation ? (
          <div className="flex flex-col gap-3 pt-1 pr-10 pb-1">
            <p className="text-foreground text-sm leading-relaxed">
              {parsedConfirmation.summary}
            </p>
            {parsedConfirmation.task ? (
              <TaskResultCard task={parsedConfirmation.task} />
            ) : null}
          </div>
        ) : (
          <Markdown className="text-foreground pt-1 pr-10 pb-1 text-sm">
            {isStreaming ? `${message.content} ▌` : message.content}
          </Markdown>
        )}
        {suggestions.length > 0 ? (
          <div className="mt-4 mb-2 flex flex-col gap-2 pr-10 sm:flex-row sm:flex-wrap">
            {suggestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onSelectSuggestion?.(prompt)}
                className={cn(
                  "group/chip border-border bg-card hover:border-foreground/30 hover:bg-muted/40 text-foreground",
                  "inline-flex max-w-full items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium",
                  "transition-colors active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
              >
                <span className="truncate text-left">{prompt}</span>
                <span
                  aria-hidden
                  className="text-muted-foreground group-hover/chip:text-primary shrink-0 transition-transform group-hover/chip:translate-x-0.5"
                >
                  →
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2 pt-0.5 pb-2">
          {!isStreaming ? (
            <CopyButton
              text={message.content}
              label={t("copyAction")}
              copiedLabel={t("copiedAction")}
            />
          ) : null}
          {durationMs !== undefined && !isStreaming ? (
            <span className="text-tertiary-foreground text-[10px] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100">
              {t("answeredIn", { seconds: Math.round(durationMs / 1000) })}
            </span>
          ) : null}
          <time
            dateTime={message.createdAt}
            className="text-tertiary-foreground text-[10px] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100"
          >
            {timestamp}
          </time>
        </div>
      </div>
    </div>
  );
}

/** Collapsible disclosure of the tool/progress steps a turn went through —
 * keeps the reasoning legible after the answer has arrived. */
function MessageSteps({
  steps,
  countLabel,
}: {
  steps: ProgressStep[];
  countLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pr-10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded text-xs font-medium transition-colors outline-none focus-visible:ring-2"
      >
        <Wrench aria-hidden className="size-3" />
        {countLabel}
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open ? (
        <div className="border-border/60 mt-1.5 flex flex-col gap-1.5 border-l pl-3">
          {steps.map((step, i) =>
            step.kind === "reasoning" ? (
              <p
                key={`${step.label}-${i}`}
                className="text-muted-foreground pl-[18px] text-xs italic"
              >
                {step.label}
              </p>
            ) : (
              <ToolStepRow key={`${step.label}-${i}`} step={step} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function ToolStepRow({ step }: { step: ProgressStep }) {
  return (
    <div className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <Check aria-hidden className="text-primary/60 mt-0.5 size-3 shrink-0" />
      <span className="min-w-0">
        <span className="text-foreground/80 font-medium">{step.label}</span>
        {step.detail ? (
          <span className="text-muted-foreground"> — {step.detail}</span>
        ) : null}
      </span>
    </div>
  );
}

/** Hover-to-copy control for an assistant message. */
function CopyButton({
  text,
  label,
  copiedLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? copiedLabel : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border/70 focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {copied ? (
        <>
          <Check aria-hidden className="size-3.5" />
          {copiedLabel}
        </>
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
    </button>
  );
}

interface OutboxKindChip {
  label: string;
}

function describeOutboxKind(
  kind: string | null,
  t: (key: string) => string,
): OutboxKindChip | null {
  if (!kind || kind === "text") return null;
  if (kind === "welcome" || kind === "research_intro" || kind === "returning") {
    return { label: t("outboxKinds.welcome") };
  }
  if (kind === "daily_brief") return { label: t("outboxKinds.daily_brief") };
  if (kind === "job_complete") return { label: t("outboxKinds.job_complete") };
  if (kind === "task_result") return { label: t("outboxKinds.task_result") };
  if (kind === "daily_suggestions") {
    return { label: t("outboxKinds.daily_suggestions") };
  }
  if (kind === "reminder") return { label: t("outboxKinds.reminder") };
  if (kind === "confirmation_resolved") {
    return { label: t("outboxKinds.confirmation_resolved") };
  }
  return { label: t("outboxKinds.default") };
}

/** Transient chain-of-thought beat, shown live and superseded by the next
 * phase frame (held on screen ≥ REASONING_MIN_MS so it doesn't blink). */
function ReasoningLine({ snippet }: { snippet: string }) {
  return (
    <div className="flex w-full items-start gap-3 px-4 pb-1">
      {/* Gutter aligns under the avatar shown by the indicator above. */}
      <div className="size-8 shrink-0" aria-hidden />
      <p className="reasoning-text-shine text-muted-foreground line-clamp-2 max-w-2xl pt-0.5 text-sm italic">
        {snippet}
      </p>
    </div>
  );
}

function ProgressChips({
  chips,
  startedAt,
}: {
  chips: ProgressStep[];
  startedAt?: number | null;
}) {
  return (
    <div className="flex w-full items-start gap-3 px-4 py-1.5">
      {/* The active avatar — "focused" eyes while a tool runs, so it reads as
          working rather than just drafting (the typing indicator stays
          "thinking"). */}
      <span className="relative shrink-0">
        <span
          aria-hidden
          className="bg-primary/30 absolute inset-0 animate-ping rounded-full"
        />
        <AssistantAvatar animated expression="focused" />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 pt-1">
        {chips.map((chip, i) => {
          const isLast = i === chips.length - 1;
          return (
            <div
              key={`${chip.id ?? chip.label}-${i}`}
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              {chip.done ? (
                <Check
                  aria-hidden
                  className="text-primary/70 size-3.5 shrink-0"
                />
              ) : (
                <Loader2
                  aria-hidden
                  className="text-primary size-3.5 shrink-0 animate-spin"
                />
              )}
              <span className="text-foreground shrink-0 font-medium">
                {chip.label}
              </span>
              {chip.detail ? (
                <span className="text-muted-foreground truncate">
                  {chip.detail}
                </span>
              ) : null}
              {isLast && startedAt ? (
                <ElapsedTimer startedAt={startedAt} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Pool of "thinking" messages that cycle while Hermes drafts a reply. Mix
 * of straight-faced and lightly silly so users have something to read
 * during long inference runs without it feeling robotic. Each phrase
 * stands on its own — no trailing ellipsis here, the typing dots animate
 * separately. New phrases welcome, just keep them short.
 */
/** Live "Ns" counter since the turn started — keeps a long wait legible. */
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const label =
    secs < 60
      ? `${secs}s`
      : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <span className="text-muted-foreground/70 ml-1.5 text-xs tabular-nums">
      {label}
    </span>
  );
}

function AssistantTyping({ startedAt }: { startedAt?: number | null }) {
  const t = useTranslations("App.Hermes.Running");
  const thinkingMessages = orderedMessageList(
    t.raw("thinkingMessages") as Record<string, string>,
  );
  // Escalate reassurance on long waits so a 30s+ turn doesn't read as stuck.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const secs = startedAt
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const escalation =
    secs >= 40 ? t("stillWorkingLong") : secs >= 15 ? t("stillWorking") : null;

  return (
    <div className="flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      {/* Avatar with a slow pulse ring so it reads as "working" at a glance */}
      <span className="relative shrink-0">
        <span
          aria-hidden
          className="bg-primary/30 absolute inset-0 animate-ping rounded-full"
        />
        <AssistantAvatar animated expression="thinking" />
      </span>

      {/* Rotating phrase + three pulsing dots. Phrase change has its own
          fade (from RotatingMessages); the dots run independently so there
          is always something animating even between fades. */}
      <div className="flex min-h-5 items-center gap-1 pt-2">
        {escalation ? (
          <span className="reasoning-text-shine text-foreground text-sm leading-5">
            {escalation}
          </span>
        ) : (
          <RotatingMessages
            messages={thinkingMessages}
            intervalMs={2_800}
            className="reasoning-text-shine text-foreground text-sm leading-5"
          />
        )}
        <span aria-hidden className="text-foreground/70 inline-flex gap-0.5">
          <span className="animate-thinking-dot inline-block">.</span>
          <span className="animate-thinking-dot inline-block [animation-delay:200ms]">
            .
          </span>
          <span className="animate-thinking-dot inline-block [animation-delay:400ms]">
            .
          </span>
        </span>
        {startedAt ? <ElapsedTimer startedAt={startedAt} /> : null}
      </div>
    </div>
  );
}

function AssistantAvatar({
  accent = false,
  animated = false,
  expression,
}: {
  accent?: boolean;
  /** Live canvas (one rAF loop) — use only for the single "thinking" avatar. */
  animated?: boolean;
  /** Eyes override — "thinking" while it writes. Omit to use the personality's
   * resting expression. */
  expression?: OrbExpression;
} = {}) {
  const tCommon = useTranslations("App.Hermes.Common");
  const seed = useContext(AssistantSeedContext);
  const motion = useContext(AssistantMotionContext);
  const speed =
    expression === "thinking" || expression === "focused"
      ? motion.activeSpeed
      : motion.speed;

  return (
    <AuroraOrb
      seed={seed}
      size={64}
      animate={animated}
      speed={speed}
      expression={expression ?? motion.restExpression}
      alt={tCommon("hermesAvatarAlt")}
      className={cn(
        "size-8 ring-1",
        accent ? "ring-border/80" : "ring-border/40",
      )}
    />
  );
}

interface ComposerProps {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (v: string) => void;
  files: File[];
  setFiles: (files: File[]) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isReplying: boolean;
  /** When true (e.g. orchestrator is mid-apply), block the user from sending. */
  disabled?: boolean;
  onStop: () => void;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  attachLabel: string;
}

/**
 * Rotating hints shown in the composer placeholder when the user hasn't
 * typed anything. Gives first-session users concrete things to try without
 * adding chrome below the welcome.
 */
const ROTATE_INTERVAL_MS = 4_500;

function Composer({
  ref,
  input,
  setInput,
  files,
  setFiles,
  onSubmit,
  isReplying,
  disabled = false,
  onStop,
  placeholder,
  sendLabel,
  stopLabel,
  attachLabel,
}: ComposerProps) {
  const t = useTranslations("App.Hermes.Running");
  const rotatingHints = orderedMessageList(
    t.raw("rotatingHints") as Record<string, string>,
  );
  const canSend =
    (input.trim().length > 0 || files.length > 0) && !isReplying && !disabled;
  const status = isReplying ? "streaming" : "ready";

  // Rotate hint placeholders while the composer is empty + idle. As soon as
  // the user types or starts a turn, freeze on the default placeholder so we
  // don't visually fight the typing experience.
  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    if (input.length > 0 || isReplying) return;
    const id = window.setInterval(
      () => setHintIdx((i) => (i + 1) % rotatingHints.length),
      ROTATE_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [input.length, isReplying, rotatingHints.length]);
  const dynamicPlaceholder =
    input.length > 0 || isReplying
      ? placeholder
      : (rotatingHints[hintIdx] ?? placeholder);

  return (
    <FileUpload
      value={files}
      onValueChange={setFiles}
      multiple
      maxSize={20 * 1024 * 1024}
      className="w-full"
      label={attachLabel}
    >
      <PromptInput
        onSubmit={onSubmit}
        className={cn(
          "border-border bg-background focus-within:border-border hover:border-muted-foreground/50 rounded-xl border transition-all duration-200",
          disabled && "opacity-60 pointer-events-none",
        )}
      >
        <FileUploadDropzone
          className="data-dragging:bg-accent/20 w-full items-stretch justify-start border-0 p-0 hover:bg-transparent"
          onClick={(event) => event.preventDefault()}
        >
          <PromptInputTextarea
            ref={ref}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              disabled ? t("composerDisabledPlaceholder") : dynamicPlaceholder
            }
            disableAutoResize
            maxHeight={200}
            minHeight={44}
            autoFocus
            disabled={disabled}
            className="placeholder:text-muted-foreground scrollbar-none grow resize-none border-0! bg-transparent p-4 text-base ring-0 outline-none [-ms-overflow-style:none] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
          />
        </FileUploadDropzone>

        <FileUploadList orientation="horizontal" className="gap-2 px-3 pb-1">
          {files.map((file) => (
            <FileUploadItem
              key={`${file.name}-${file.lastModified}`}
              value={file}
              className="bg-muted/40 border-border/60 flex max-w-56 items-center gap-2 rounded-md border px-2 py-1.5"
            >
              <FileUploadItemPreview className="size-7 shrink-0 rounded" />
              <FileUploadItemMetadata className="min-w-0 flex-1 text-xs" />
              <FileUploadItemDelete asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground size-6 shrink-0 rounded-full"
                  aria-label={t("removeFile")}
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              </FileUploadItemDelete>
            </FileUploadItem>
          ))}
        </FileUploadList>

        <PromptInputToolbar className="border-t-0 p-3">
          <PromptInputTools className="flex-wrap gap-1 sm:gap-1.5">
            <FileUploadTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="size-8 rounded-full! p-0"
                title={attachLabel}
                aria-label={attachLabel}
              >
                <Plus className="size-3.5" />
              </Button>
            </FileUploadTrigger>
          </PromptInputTools>

          {isReplying ? (
            <Button
              type="button"
              variant="default"
              size="icon"
              onClick={onStop}
              aria-label={stopLabel}
              className="size-8 rounded-full"
            >
              <StopIcon size={14} />
            </Button>
          ) : (
            <PromptInputSubmit
              className="size-8 rounded-full transition-colors duration-200"
              disabled={!canSend}
              status={status}
              aria-label={sendLabel}
            >
              <ArrowUpIcon size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>
    </FileUpload>
  );
}

const INTEGRATION_ICON_BY_PROVIDER: Record<HermesIntegrationProvider, string> =
  {
    gmail: "/icons/gmail.svg",
    google_calendar: "/icons/google-calendar.svg",
    google_sheets: "/icons/google-sheets.svg",
    google_docs: "/icons/google-docs.svg",
    outlook: "/icons/outlook.svg",
    outlook_calendar: "/icons/outlook.svg",
    slack: "/icons/slack.svg",
    teams: "/icons/teams.svg",
    linear: "/icons/linear.svg",
    jira: "/icons/jira.svg",
    github: "/icons/github.svg",
    notion: "/icons/notion.svg",
    hubspot: "/icons/hubspot.svg",
    twitter: "/icons/x.svg",
    instagram: "/icons/instagram.svg",
    youtube: "/icons/youtube.svg",
    linkedin: "/icons/linkedin.svg",
  };

/**
 * Some Composio toolkits cover multiple orchestrator provider strings
 * from a single OAuth (Outlook's mail + calendar share one consent and
 * land as two integration rows). The chat chip should treat those as
 * one connected service so the count + icon stack reflect reality.
 */
function canonicalServiceKey(provider: HermesIntegrationProvider): string {
  if (provider === "outlook" || provider === "outlook_calendar") {
    return "outlook";
  }
  return provider;
}

function dedupeServiceIntegrations(
  integrations: HermesIntegrationPublic[],
): HermesIntegrationPublic[] {
  const seen = new Set<string>();
  const result: HermesIntegrationPublic[] = [];
  for (const integration of integrations) {
    const key = canonicalServiceKey(integration.provider);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(integration);
  }
  return result;
}

function IntegrationsChip({
  integrations,
  onClick,
}: {
  integrations: HermesIntegrationPublic[];
  onClick: () => void;
}) {
  const t = useTranslations("App.Hermes.Running.integrationsChip");
  // Dedupe paired providers (outlook + outlook_calendar share one OAuth)
  // so the chip shows one entry per real service. Otherwise a single
  // Outlook connection looks like "2 connected" with the same icon twice.
  const connected = dedupeServiceIntegrations(
    integrations.filter((i) => i.status === "connected"),
  );
  const stacked = connected.slice(0, 3);
  const hasAny = connected.length > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="border-border bg-card text-foreground hover:bg-muted/40 hover:border-foreground/30 inline-flex h-8 items-center gap-2 rounded-full border pl-1.5 pr-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={
            hasAny
              ? t("ariaConnected", { count: connected.length })
              : t("connectIntegrations")
          }
        >
          {hasAny ? (
            <>
              <span className="flex items-center -space-x-1.5">
                {stacked.map((i) => (
                  <span
                    key={i.provider}
                    className="border-card bg-background inline-flex size-5 items-center justify-center rounded-full border-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={INTEGRATION_ICON_BY_PROVIDER[i.provider]}
                      alt=""
                      className="size-3"
                    />
                  </span>
                ))}
              </span>
              <span className="tabular-nums">{connected.length}</span>
            </>
          ) : (
            <>
              <Plug className="text-tertiary-foreground size-3.5" aria-hidden />
              <span>{t("connect")}</span>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {hasAny ? t("integrations") : t("connectIntegrations")}
      </TooltipContent>
    </Tooltip>
  );
}

type HermesIntegrationPublic = NonNullable<
  RunningStateProps["instance"]
>["integrations"][number];
type HermesIntegrationProvider = HermesIntegrationPublic["provider"];

/**
 * Same RFC-4122 UUID pattern the server uses to resolve coworker /
 * organization ids in the summary. Splitting on this lets us interleave
 * `<CoworkerRefChip>` / `<OrgRefChip>` exactly where the orchestrator
 * wrote the id.
 */
const SUMMARY_UUID_PATTERN =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Dev preview: synthesizes a fake pending confirmation referencing a real
 * coworker so the ConfirmationCard renders with avatar + name chips
 * locally, without waiting on the orchestrator. Activated by
 * `?state=running&mock=confirmation`. Optional overrides via
 * `&toolName=sokosumi_create_job&coworkerId=<uuid>&coworkerName=<name>&coworkerImage=<url>`.
 */
function buildMockPendingConfirmations(
  params: Pick<URLSearchParams, "get">,
): HermesPendingConfirmation[] {
  if (params.get("mock") !== "confirmation") return [];
  const requestedToolName = params.get("toolName");
  const toolName =
    requestedToolName && isConfirmationOrgAwareTool(requestedToolName)
      ? requestedToolName
      : "sokosumi_create_task";
  const coworkerId =
    params.get("coworkerId") ?? "0e8c93b0-5332-4734-b603-ea18d17b50c5";
  const coworkerName = params.get("coworkerName") ?? "Hannah";
  const coworkerImage = params.get("coworkerImage");
  const summary =
    toolName === "sokosumi_create_job"
      ? `Create a new job "Research: Teodor Petricevic — UNDP AltFinLab" and assign it to coworker ${coworkerId}.`
      : `Create a new task "Research: Teodor Petricevic — UNDP AltFinLab" and assign it to coworker ${coworkerId}.`;
  return [
    {
      id: "mock-confirmation-1",
      toolName,
      summary,
      createdAt: new Date().toISOString(),
      referencedCoworkers: [
        {
          id: coworkerId,
          name: coworkerName,
          image: coworkerImage,
        },
      ],
      referencedOrganizations: [],
      // Optional preview overrides for the proposed-workspace dropdown default.
      organizationId: params.get("organizationId"),
      organizationName: params.get("organizationName"),
    },
  ];
}

function renderConfirmationSummary(
  confirmation: HermesPendingConfirmation,
): React.ReactNode {
  const { summary, referencedCoworkers, referencedOrganizations } =
    confirmation;
  if (
    referencedCoworkers.length === 0 &&
    referencedOrganizations.length === 0
  ) {
    return summary;
  }
  const coworkerById = new Map(
    referencedCoworkers.map((c) => [c.id.toLowerCase(), c]),
  );
  const orgById = new Map(
    referencedOrganizations.map((o) => [o.id.toLowerCase(), o]),
  );

  return summary.split(SUMMARY_UUID_PATTERN).map((part, index) => {
    const key = `${index}-${part}`;
    const lower = part.toLowerCase();
    const coworker = coworkerById.get(lower);
    if (coworker) {
      return <CoworkerRefChip key={key} coworker={coworker} />;
    }
    const organization = orgById.get(lower);
    if (organization) {
      return <OrgRefChip key={key} organization={organization} />;
    }
    // Unresolved chunk — either non-UUID prose or an id we couldn't
    // attribute to this user. Render verbatim.
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function CoworkerRefChip({
  coworker,
}: {
  coworker: HermesPendingConfirmation["referencedCoworkers"][number];
}) {
  return (
    <span className="border-border/60 bg-card/80 text-foreground mx-0.5 inline-flex max-w-56 items-center gap-1.5 rounded-md border px-1.5 py-0.5 align-middle text-xs font-medium">
      {coworker.image ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={coworker.image}
          alt=""
          className="border-border size-4 shrink-0 rounded-full border"
        />
      ) : (
        <span className="bg-muted text-muted-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
          {coworker.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate">{coworker.name}</span>
    </span>
  );
}

function OrgRefChip({
  organization,
}: {
  organization: HermesPendingConfirmation["referencedOrganizations"][number];
}) {
  return (
    <span className="border-border/60 bg-card/80 text-foreground mx-0.5 inline-flex max-w-56 items-center gap-1.5 rounded-md border px-1.5 py-0.5 align-middle text-xs font-medium">
      <Building2
        className="text-muted-foreground size-3.5 shrink-0"
        aria-hidden
      />
      <span className="truncate">{organization.name}</span>
    </span>
  );
}

/**
 * Inline approve/reject card for medium-autonomy gates. Approve/reject only
 * move the card into the read-only audit trail when the orchestrator reports
 * the matching terminal status (`approved` / `rejected`). When the
 * orchestrator returns `status === "errored"` (HTTP 200), we show a toast and
 * leave the card interactive so the user can retry. `already_resolved` and
 * the opposite resolution on either action still settle the card — the gate
 * was handled elsewhere (another tab, stale list, etc.).
 */
/**
 * Tools that may spend credits. `sokosumi_create_job` always does; tasks
 * spend once a coworker actually runs against them. Either way we want
 * the user to see the "costs deduct from credits" notice before they
 * approve.
 */
const COST_BEARING_TOOLS = new Set([
  "sokosumi_create_task",
  "sokosumi_create_job",
]);

/**
 * Captures what the user did with a confirmation so the card can be
 * re-rendered as a read-only audit trail. `organizationId === undefined`
 * means the tool wasn't org-aware (no dropdown was shown); `null` means
 * the user explicitly picked personal scope.
 */
interface ConfirmationResolution {
  status: "approved" | "rejected" | "already_resolved";
  organizationId?: string | null;
}

interface ResolvedConfirmationEntry {
  confirmation: HermesPendingConfirmation;
  resolution: ConfirmationResolution;
  /**
   * Fixed timeline position: just past the newest message visible at the
   * moment the user resolved the card. Snapshotted once so the card stays
   * exactly where the user acted — mixing the gate's server `createdAt`
   * with client-clock message timestamps let the card teleport above the
   * user's own (optimistically-stamped) message on approval, then strand
   * far up in the scrollback once the post-turn re-sync rewrote message
   * ids/timestamps to server time.
   */
  timelineTs: number;
}

function ConfirmationCard({
  confirmation,
  onResolved,
  organizations,
  activeOrganizationId,
  resolution,
}: {
  confirmation: HermesPendingConfirmation;
  onResolved: (
    confirmationId: string,
    resolution: ConfirmationResolution,
    confirmation: HermesPendingConfirmation,
  ) => void;
  organizations: HermesOrganizationOption[];
  activeOrganizationId: string | null;
  /** Non-null means the user already resolved this card; render read-only. */
  resolution: ConfirmationResolution | null;
}) {
  const t = useTranslations("App.Hermes.Running.confirmation");
  const [busy, setBusy] = useState<"approving" | "rejecting" | null>(null);

  const isResolved = resolution !== null;
  const showOrgPicker = isConfirmationOrgAwareTool(confirmation.toolName);
  const showCostNotice = COST_BEARING_TOOLS.has(confirmation.toolName);
  const orgPickerOptions = mergeConfirmationOrgPickerOptions(
    organizations,
    confirmation,
  );
  const initialOrgValue =
    resolution && resolution.organizationId !== undefined
      ? (resolution.organizationId ?? CONFIRMATION_PERSONAL_SCOPE_VALUE)
      : resolveConfirmationOrgPickerValue(
          confirmation,
          organizations,
          activeOrganizationId,
        );
  const proposedOrgValue = resolveConfirmationOrgPickerValue(
    confirmation,
    organizations,
    activeOrganizationId,
  );
  const [orgSelection, setOrgSelection] = useState(() => ({
    baselineOrgValue: initialOrgValue,
    selectedOrgValue: initialOrgValue,
    userChangedOrg: false,
  }));
  const selectedOrgRef = useRef(orgSelection.selectedOrgValue);
  selectedOrgRef.current = orgSelection.selectedOrgValue;

  if (!isResolved && showOrgPicker) {
    const syncedOrgSelection = applyConfirmationOrgProposalUpdate(
      proposedOrgValue,
      orgSelection,
    );
    if (syncedOrgSelection !== orgSelection) {
      setOrgSelection(syncedOrgSelection);
      selectedOrgRef.current = syncedOrgSelection.selectedOrgValue;
    }
  }

  const selectedOrgValue = orgSelection.selectedOrgValue;

  const handleOrgValueChange = (value: string) => {
    selectedOrgRef.current = value;
    setOrgSelection((current) => ({
      ...current,
      selectedOrgValue: value,
      userChangedOrg: true,
    }));
  };

  const handleApprove = async () => {
    if (busy || isResolved) return;
    setBusy("approving");
    // The workspace dropdown shows a local default that may NOT match the
    // workspace Hermes proposed in its tool call. Only send an organization
    // override when the user actually changes the dropdown; if they leave it
    // untouched, omit the field entirely so Hermes' proposed workspace stands.
    // Sending `organizationId` (incl. `null` for Personal) on an untouched
    // dropdown asserts a workspace choice the user never made and clobbers
    // Hermes' selection — e.g. filing a task in Personal instead of the org
    // Hermes chose. The dropdown default is reconciled with Hermes' actual
    // proposal separately (pending orchestrator-provided proposed workspace).
    // Current dropdown selection — used for the resolved-card audit display.
    const workspaceSelection = showOrgPicker
      ? buildCurrentConfirmationApproveOrganizationOverride(
          selectedOrgRef,
          orgPickerOptions,
        )
      : undefined;
    // Override actually sent: only when the user changed the workspace, so an
    // untouched dropdown leaves Hermes' proposed workspace intact.
    const workspaceOverride = showOrgPicker
      ? buildConfirmationApproveOverrideIfChanged(
          selectedOrgRef.current,
          orgSelection.baselineOrgValue,
          orgPickerOptions,
        )
      : undefined;
    const result = await approveHermesConfirmationAction(
      workspaceOverride
        ? {
            confirmationId: confirmation.id,
            ...workspaceOverride,
          }
        : { confirmationId: confirmation.id },
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.message ?? t("approveFailed"));
      return;
    }
    const { status } = result.data;
    const resolutionOrgId = workspaceSelection?.organizationId;

    if (status === "errored") {
      toast.error(result.data.error ?? t("erroredAfterApproval"));
      return;
    }
    if (status === "approved") {
      toast.success(t("approvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "approved",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
      return;
    }
    if (status === "already_resolved") {
      toast.info(t("alreadyResolvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "already_resolved",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
      return;
    }
    if (status === "rejected") {
      toast.info(t("alreadyResolvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "rejected",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
    }
  };

  const handleReject = async () => {
    if (busy || isResolved) return;
    setBusy("rejecting");
    const resolutionOrgId = showOrgPicker
      ? buildCurrentConfirmationApproveOrganizationOverride(
          selectedOrgRef,
          orgPickerOptions,
        ).organizationId
      : undefined;
    const result = await rejectHermesConfirmationAction({
      confirmationId: confirmation.id,
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.message ?? t("rejectFailed"));
      return;
    }
    const { status } = result.data;

    if (status === "errored") {
      toast.error(result.data.error ?? t("rejectFailed"));
      return;
    }
    if (status === "rejected") {
      toast.success(t("rejectedToast"));
      onResolved(
        confirmation.id,
        {
          status: "rejected",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
      return;
    }
    if (status === "already_resolved") {
      toast.info(t("alreadyResolvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "already_resolved",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
      return;
    }
    if (status === "approved") {
      toast.info(t("alreadyResolvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "approved",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
    }
  };

  const tool = describeConfirmationTool(confirmation.toolName, (key) => t(key));
  const summaryFragments = renderConfirmationSummary(confirmation);

  // Resolved cards: same layout, muted chrome, status pill instead of
  // buttons, dropdown locked to the user's earlier choice. Renders as a
  // read-only audit trail in the chat.
  const isApproved = resolution?.status === "approved";
  const isAlreadyResolved = resolution?.status === "already_resolved";

  return (
    <div className="flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      <AssistantAvatar accent={!isResolved} />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border px-4 py-3 backdrop-blur-sm",
          isResolved
            ? "border-border/60 bg-muted/30"
            : "border-amber-500/30 bg-amber-500/6",
        )}
      >
        <div
          className={cn(
            "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider",
            isResolved
              ? "text-muted-foreground"
              : "text-amber-700 dark:text-amber-400",
          )}
        >
          {isResolved ? (
            isApproved || isAlreadyResolved ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <X className="size-3.5" aria-hidden />
            )
          ) : (
            <AlertCircle className="size-3.5" aria-hidden />
          )}
          <span>
            {isResolved
              ? isApproved
                ? t("approvedStatus")
                : isAlreadyResolved
                  ? t("alreadyResolvedStatus")
                  : t("rejectedStatus")
              : t("heading")}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <div
            className={cn(
              "text-sm font-semibold tracking-tight",
              isResolved ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {tool.action}
          </div>
          <p
            className={cn(
              "text-sm leading-relaxed",
              isResolved ? "text-muted-foreground" : "text-foreground/90",
            )}
          >
            {summaryFragments}
          </p>
        </div>
        {isResolved &&
        isApproved &&
        confirmation.toolName === "sokosumi_create_task" ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5 shrink-0" aria-hidden />
            <span>{t("creatingInBackground")}</span>
          </div>
        ) : null}
        {showOrgPicker ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`confirm-org-${confirmation.id}`}
              className="text-muted-foreground text-xs font-medium uppercase tracking-wider"
            >
              {t("organizationLabel")}
            </label>
            <Select
              value={selectedOrgValue}
              onValueChange={handleOrgValueChange}
              disabled={busy !== null || isResolved}
            >
              <SelectTrigger
                id={`confirm-org-${confirmation.id}`}
                size="sm"
                className="w-full max-w-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CONFIRMATION_PERSONAL_SCOPE_VALUE}>
                  {t("organizationPersonal")}
                </SelectItem>
                {orgPickerOptions.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {showCostNotice && !isResolved ? (
          <div className="border-border/60 bg-muted/30 text-muted-foreground flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs leading-relaxed">
            <Coins className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t("costNotice")}</span>
          </div>
        ) : null}
        {isResolved ? null : (
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={() => void handleApprove()}
            >
              {busy === "approving" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-3.5" aria-hidden />
              )}
              <span>{t("approve")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={() => void handleReject()}
            >
              {busy === "rejecting" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <X className="size-3.5" aria-hidden />
              )}
              <span>{t("reject")}</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation-resolved message rendering
//
// The orchestrator pushes a `confirmation_resolved` outbox message after the
// user approves a tool call, with body shaped like:
//
//   The user approved your earlier sokosumi_create_task request. The action
//   was executed; here's the result you can act on:
//   { ...big JSON blob... }
//
// Dumping that JSON in chat is hostile. Parse it, render the prose intro,
// and if the payload is a known shape (currently sokosumi_create_task)
// render a Task Card linking to /tasks/:id instead.

interface ParsedTaskResult {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  credits: number | null;
  coworker: { name: string; image: string | null } | null;
  organization: { name: string; slug: string | null } | null;
}

interface ParsedConfirmationResolved {
  /** Prose lead-in with the JSON block stripped out. */
  summary: string;
  /** Populated when the JSON payload matched the sokosumi_create_task shape. */
  task: ParsedTaskResult | null;
}

function parseConfirmationResolved(
  content: string,
  fallbacks: {
    resolvedFallback: string;
    coworkerFallback: string;
    organizationFallback: string;
  },
): ParsedConfirmationResolved | null {
  if (!content) return null;
  // Find the first opening brace at the start of a line, take everything
  // from there as the JSON region. The intro prose is whatever comes before.
  const braceIdx = content.search(/^\s*{/m);
  if (braceIdx < 0) {
    // No JSON in the body — just return the message as-is so the caller
    // can render it as plain markdown again.
    return null;
  }
  const summary = content.slice(0, braceIdx).trim();
  const rawJson = content.slice(braceIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { summary: summary || content, task: null };
  }

  return {
    summary: summary || fallbacks.resolvedFallback,
    task: extractTaskFromConfirmation(parsed, fallbacks),
  };
}

function extractTaskFromConfirmation(
  payload: unknown,
  fallbacks: {
    coworkerFallback: string;
    organizationFallback: string;
  },
): ParsedTaskResult | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const taskWrapper = root.task as Record<string, unknown> | undefined;
  const data = (taskWrapper?.data ?? taskWrapper) as
    | Record<string, unknown>
    | undefined;
  if (!data || typeof data !== "object") return null;

  const id = typeof data.id === "string" ? data.id : null;
  const name = typeof data.name === "string" ? data.name : null;
  if (!id || !name) return null;

  const coworker = data.coworker as Record<string, unknown> | null | undefined;
  const organization = data.organization as
    | Record<string, unknown>
    | null
    | undefined;

  return {
    id,
    name,
    description: typeof data.description === "string" ? data.description : null,
    status: typeof data.status === "string" ? data.status : null,
    credits: typeof data.credits === "number" ? data.credits : null,
    coworker: coworker
      ? {
          name:
            typeof coworker.name === "string"
              ? coworker.name
              : fallbacks.coworkerFallback,
          image: typeof coworker.image === "string" ? coworker.image : null,
        }
      : null,
    organization: organization
      ? {
          name:
            typeof organization.name === "string"
              ? organization.name
              : fallbacks.organizationFallback,
          slug:
            typeof organization.slug === "string" ? organization.slug : null,
        }
      : null,
  };
}

/**
 * A compact card for `sokosumi_create_task` results pushed via
 * `confirmation_resolved`. Replaces what would otherwise be a 60-line raw
 * JSON dump with the bits a human actually wants: name, who it's assigned
 * to, status, and a deep link.
 */
function TaskResultCard({ task }: { task: ParsedTaskResult }) {
  const t = useTranslations("App.Hermes.Running.confirmation.taskCard");

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="border-border bg-card/60 hover:border-foreground/30 hover:bg-card group/task-card flex max-w-2xl flex-col gap-3 rounded-2xl border p-4 transition-colors"
    >
      <div className="flex items-center gap-2">
        {task.coworker?.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={task.coworker.image}
            alt=""
            className="border-border size-6 shrink-0 rounded-full border"
          />
        ) : task.coworker ? (
          <span className="bg-muted text-muted-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {task.coworker.name.charAt(0).toUpperCase()}
          </span>
        ) : null}
        <span className="text-foreground text-sm font-medium">
          {task.coworker?.name ?? t("defaultTask")}
        </span>
        {task.organization ? (
          <>
            <span className="text-tertiary-foreground text-xs">·</span>
            <span className="text-muted-foreground text-xs">
              {task.organization.name}
            </span>
          </>
        ) : null}
        {task.status ? (
          <span className="border-border/60 text-muted-foreground ml-auto rounded-full border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider">
            {task.status.toLowerCase()}
          </span>
        ) : null}
      </div>

      <div>
        <div className="text-foreground text-base font-semibold tracking-tight">
          {task.name}
        </div>
        {task.description ? (
          <p className="text-muted-foreground mt-1 line-clamp-3 text-sm leading-relaxed">
            {task.description}
          </p>
        ) : null}
      </div>

      <div className="text-muted-foreground group-hover/task-card:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors">
        <span>{t("viewTask")}</span>
        <ArrowUpRight className="size-3.5" aria-hidden />
      </div>
    </Link>
  );
}

/**
 * Maps a tool slug to user-facing copy for the confirmation card.
 * Hides the technical sokosumi_* prefix; falls back to the raw slug for
 * future kinds.
 */
const CONFIRMATION_TOOL_KEYS = [
  "sokosumi_create_task",
  "sokosumi_create_job",
  "sokosumi_add_task_comment",
  "sokosumi_provide_job_input",
  "sokosumi_refund_job",
] as const;

function describeConfirmationTool(
  toolName: string,
  t: (key: string) => string,
): {
  action: string;
  helper: string;
} {
  if ((CONFIRMATION_TOOL_KEYS as readonly string[]).includes(toolName)) {
    return {
      action: t(`tools.${toolName}.action`),
      helper: t(`tools.${toolName}.helper`),
    };
  }
  return { action: toolName, helper: "" };
}
