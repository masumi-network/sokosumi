"use client";

import { Loader2, Plug, Plus, X } from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import RotatingMessages from "@/app/hermes/components/rotating-messages";
import SettingsPanel from "@/app/hermes/components/settings-panel";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  listHermesMessagesAction,
  markHermesInboxSeenAction,
} from "@/lib/actions/hermes";
import type {
  HermesInstancePublic,
  HermesPersistedMessage,
} from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

interface RunningStateProps {
  userName?: string | null;
  userImageUrl?: string | null;
  instance: HermesInstancePublic | null;
  previewMode: boolean;
  initialMessages?: HermesPersistedMessage[];
  onDestroy: () => Promise<void> | void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Outbox kind for agent-initiated pushes (task_result, reminder, …). Null for normal chat turns. */
  kind: string | null;
  createdAt: string;
}

const POLL_INTERVAL_MS = 5_000;

function persistedToMessage(m: HermesPersistedMessage): Message | null {
  if (m.role !== "user" && m.role !== "assistant") return null;
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    kind: m.kind,
    createdAt: m.createdAt,
  };
}

const MOCK_REPLIES = [
  "I'm a mock response from your local Hermes preview. Set ?state=running off to see the real Hermes wired through the orchestrator.",
  "Got it. In production, your message goes through Sokosumi's server, the orchestrator returns your private endpoint, and Hermes responds.",
  "Here's what I'd do: persist this in long-term memory, add a follow-up to your task list, and keep the context for our next session.",
];

function pickReply(turn: number): string {
  return MOCK_REPLIES[turn % MOCK_REPLIES.length] ?? MOCK_REPLIES[0]!;
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
  instance,
  previewMode,
  initialMessages,
  onDestroy,
}: RunningStateProps) {
  const t = useTranslations("App.Hermes.Running");

  const [messages, setMessages] = useState<Message[]>(() =>
    (initialMessages ?? [])
      .map(persistedToMessage)
      .filter((m): m is Message => m !== null),
  );
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isReplying, setIsReplying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const isReplyingRef = useRef(false);

  useEffect(() => {
    isReplyingRef.current = isReplying;
  }, [isReplying]);

  useEffect(() => {
    return () => {
      if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
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
        // Cheap shallow check to avoid unnecessary rerenders + scroll jitter.
        if (prev.length === next.length) {
          let same = true;
          for (let i = 0; i < prev.length; i++) {
            if (prev[i]!.id !== next[i]!.id) {
              same = false;
              break;
            }
          }
          if (same) return prev;
        }
        return next;
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
              content: pickReply(turn),
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

          const res = await fetch("/api/hermes/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: trimmed,
              files: filePayloads.length > 0 ? filePayloads : undefined,
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
                ? "Your Hermes is still warming up. Try again in a few seconds."
                : (body.message ?? "Your Hermes isn't ready yet."),
            );
            setIsReplying(false);
            return;
          }

          if (!res.ok) {
            const body = (await res
              .json()
              .catch(() => ({}))) as ChatApiResponse;
            toast.error(
              body.message ?? `Hermes returned an error (${res.status}).`,
            );
            setIsReplying(false);
            return;
          }

          const body = (await res.json()) as ChatApiResponse;
          const reply = body.data?.message?.content ?? "";
          if (!reply) {
            toast.error("Hermes returned an empty response.");
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
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          toast.error("Couldn't reach Hermes. Check your connection.");
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          // Clear the polling gate synchronously (same pattern as stop()) so the
          // inbox poller is not blocked until the next React commit.
          isReplyingRef.current = false;
          setIsReplying(false);
        }
      })();
    },
    [files, isReplying, messages, previewMode],
  );

  const stop = useCallback(() => {
    if (replyTimerRef.current) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
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

  const firstName = userName?.split(" ")[0] ?? null;
  const isEmpty = messages.length === 0;

  return (
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
        className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {isEmpty ? (
          <WelcomeBlock firstName={firstName} />
        ) : (
          <div className="flex flex-col items-center pt-12 pb-6 md:pt-8">
            <div className="flex w-full max-w-4xl flex-col gap-1">
              {messages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  userImageUrl={userImageUrl}
                  userName={userName}
                  onSelectSuggestion={(prompt) => {
                    setInput(prompt);
                    composerRef.current?.focus();
                  }}
                />
              ))}
              {isReplying ? <AssistantTyping /> : null}
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
        {instance?.transitioning ? (
          <div className="mb-2 w-full max-w-4xl">
            <div className="border-primary/30 bg-primary/5 text-foreground flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm">
              <Loader2
                className="text-primary size-4 shrink-0 animate-spin"
                aria-hidden
              />
              <span>
                Hermes is applying your change…{" "}
                <span className="text-muted-foreground">
                  (this takes ~30 seconds)
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
        onDestroy={onDestroy}
      />
    </div>
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
  onSelectSuggestion,
}: {
  message: Message;
  userImageUrl?: string | null;
  userName?: string | null;
  onSelectSuggestion?: (prompt: string) => void;
}) {
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

  const chip = describeOutboxKind(message.kind);
  // Only the orchestrator's intro/welcome messages carry suggested prompts.
  const showSuggestions =
    onSelectSuggestion !== undefined &&
    (message.kind === "research_intro" ||
      message.kind === "welcome" ||
      message.kind === "returning");
  const suggestions = showSuggestions
    ? extractSuggestedPrompts(message.content)
    : [];

  return (
    <div className="group/message flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      <AssistantAvatar accent={Boolean(chip)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {chip ? (
          <span className="border-border/60 text-tertiary-foreground bg-muted/40 inline-flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide">
            <span aria-hidden>{chip.icon}</span>
            <span>{chip.label}</span>
          </span>
        ) : null}
        <Markdown className="text-foreground pt-1 pr-10 pb-1 text-sm">
          {message.content}
        </Markdown>
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
        <time
          dateTime={message.createdAt}
          className="text-tertiary-foreground pb-2 text-[10px] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100"
        >
          {timestamp}
        </time>
      </div>
    </div>
  );
}

interface OutboxKindChip {
  icon: string;
  label: string;
}

function describeOutboxKind(kind: string | null): OutboxKindChip | null {
  if (!kind || kind === "text") return null;
  if (kind === "welcome" || kind === "research_intro" || kind === "returning") {
    return { icon: "👋", label: "Welcome" };
  }
  if (kind === "daily_brief") {
    return { icon: "🌅", label: "Daily brief" };
  }
  if (kind === "job_complete") {
    return { icon: "✅", label: "Job complete" };
  }
  if (kind === "task_result") {
    return { icon: "📋", label: "Scheduled task" };
  }
  if (kind === "daily_suggestions") {
    return { icon: "💡", label: "Suggestions" };
  }
  if (kind === "reminder") {
    return { icon: "🔔", label: "Reminder" };
  }
  // Unknown future kinds — generic Hermes push.
  return { icon: "📨", label: "From Hermes" };
}

/**
 * Pool of "thinking" messages that cycle while Hermes drafts a reply. Mix
 * of straight-faced and lightly silly so users have something to read
 * during long inference runs without it feeling robotic. Each phrase
 * stands on its own — no trailing ellipsis here, the typing dots animate
 * separately. New phrases welcome, just keep them short.
 */
const THINKING_MESSAGES = [
  "Thinking",
  "Consulting the calendar gods",
  "Sifting through your inbox",
  "Reading between the lines",
  "Brewing a response",
  "Pulling up your context",
  "Asking around",
  "Picking the right tool",
  "Drafting carefully",
  "Double-checking before I act",
  "Doing the boring part for you",
  "Untangling Slack",
  "Cross-referencing memory",
  "Hunting down a detail",
  "Choosing my words",
  "Almost there",
] as const;

function AssistantTyping() {
  return (
    <div className="flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      {/* Avatar with a slow pulse ring so it reads as "working" at a glance */}
      <span className="relative shrink-0">
        <span
          aria-hidden
          className="bg-primary/30 absolute inset-0 animate-ping rounded-full"
        />
        <AssistantAvatar />
      </span>

      {/* Rotating phrase + three pulsing dots. Phrase change has its own
          fade (from RotatingMessages); the dots run independently so there
          is always something animating even between fades. */}
      <div className="flex min-h-5 items-center gap-1 pt-2">
        <RotatingMessages
          messages={THINKING_MESSAGES}
          intervalMs={2_800}
          className="reasoning-text-shine text-foreground text-sm leading-5"
        />
        <span aria-hidden className="text-foreground/70 inline-flex gap-0.5">
          <span className="animate-thinking-dot inline-block">.</span>
          <span className="animate-thinking-dot inline-block [animation-delay:200ms]">
            .
          </span>
          <span className="animate-thinking-dot inline-block [animation-delay:400ms]">
            .
          </span>
        </span>
      </div>
    </div>
  );
}

function AssistantAvatar({ accent = false }: { accent?: boolean } = {}) {
  return (
    <div
      className={cn(
        "relative size-8 shrink-0 overflow-hidden rounded-full bg-white",
        accent ? "border-border/80 border" : "border-border/60 border",
      )}
    >
      <Image
        src="/images/hermes/avatar.png"
        alt="Hermes"
        fill
        sizes="32px"
        className="object-cover"
      />
    </div>
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
const ROTATING_HINTS = [
  "Message Hermes…",
  "Try: schedule a daily inbox brief at 8am",
  "Try: summarize my open Cardano threads",
  "Try: draft a follow-up to my last meeting notes",
  "Try: what's overdue in my inbox?",
];
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
      () => setHintIdx((i) => (i + 1) % ROTATING_HINTS.length),
      ROTATE_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [input.length, isReplying]);
  const dynamicPlaceholder =
    input.length > 0 || isReplying ? placeholder : ROTATING_HINTS[hintIdx]!;

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
              disabled ? "Hermes is applying your change…" : dynamicPlaceholder
            }
            disableAutoResize
            maxHeight={200}
            minHeight={44}
            autoFocus
            disabled={disabled}
            className="placeholder:text-muted-foreground grow resize-none border-0! bg-transparent p-4 text-base ring-0 outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
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
                  aria-label="Remove"
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

function IntegrationsChip({
  integrations,
  onClick,
}: {
  integrations: HermesIntegrationPublic[];
  onClick: () => void;
}) {
  const connected = integrations.filter((i) => i.status === "connected");
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
              ? `${connected.length} integration${connected.length === 1 ? "" : "s"} connected — open settings`
              : "Connect integrations"
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
              <span>Connect</span>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {hasAny ? "Integrations" : "Connect integrations"}
      </TooltipContent>
    </Tooltip>
  );
}

type HermesIntegrationPublic = NonNullable<
  RunningStateProps["instance"]
>["integrations"][number];
type HermesIntegrationProvider = HermesIntegrationPublic["provider"];
