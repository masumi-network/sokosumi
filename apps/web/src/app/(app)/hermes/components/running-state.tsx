"use client";

import { Plus, Settings2, X } from "lucide-react";
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

import SettingsPanel from "@/app/hermes/components/settings-panel";
import { ArrowUpIcon, StopIcon } from "@/components/chat/icons";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/chat/prompt-input";
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
  message?: { role?: string; content?: string };
  error?: string;
  status?: string;
  detail?: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("file_read_failed"));
    r.readAsDataURL(file);
  });
}

function describeFileError(code: string | undefined, detail?: string): string {
  switch (code) {
    case "too_many_files":
      return "Too many files attached.";
    case "file_too_large":
      return `File is too large${detail ? `: ${detail}` : ""}. Max 20 MB per file.`;
    case "files_total_too_large":
      return "Combined attachment size is too large. Max 20 MB total.";
    case "unsupported_file_type":
      return `Unsupported file type${detail ? `: ${detail}` : ""}. Images and text-like files only.`;
    case "invalid_data_url":
    case "invalid_file_shape":
      return "One of your attachments couldn't be read.";
    default:
      return "Hermes couldn't accept your attachments.";
  }
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
  // Uses requestAnimationFrame so the scroll fires AFTER the new content has
  // committed and scrollHeight reflects it. We don't try to be clever about
  // "user scrolled up reading history" — for chat with this volume of agent
  // pushes, jumping to the latest is the right default.
  useEffect(() => {
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
          setIsReplying(false);
        }, 1200);
        return;
      }

      // Real Hermes round-trip via Sokosumi's server-side proxy. The server
      // reconstructs the full conversation from the persisted DB history; we
      // only send the new user turn + any attached files (encoded as data URLs).
      const controller = new AbortController();
      abortRef.current = controller;
      const filesToSend = files;

      void (async () => {
        try {
          const filePayloads = await Promise.all(
            filesToSend.map(async (f) => ({
              name: f.name,
              type: f.type || "application/octet-stream",
              dataUrl: await fileToDataUrl(f),
            })),
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
              body.status === "provisioning"
                ? "Your Hermes is still warming up. Try again in a few seconds."
                : "Your Hermes isn't ready yet.",
            );
            setIsReplying(false);
            return;
          }

          if (res.status === 400 || res.status === 413) {
            const body = (await res
              .json()
              .catch(() => ({}))) as ChatApiResponse;
            toast.error(describeFileError(body.error, body.detail));
            setIsReplying(false);
            return;
          }

          if (!res.ok) {
            toast.error(`Hermes returned an error (${res.status}).`);
            setIsReplying(false);
            return;
          }

          const data = (await res.json()) as ChatApiResponse;
          const reply = data.message?.content ?? "";
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
      <div className="relative flex h-full min-h-0 w-full flex-col">
        {/* Floating top-right controls */}
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSettingsOpen(true)}
                className="text-tertiary-foreground hover:text-foreground size-8"
                aria-label={t("settingsCta")}
              >
                <Settings2 className="size-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("settingsCta")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Scrollable content area */}
        <div className="absolute inset-x-0 top-0 bottom-32 overflow-hidden">
          <div
            ref={scrollerRef}
            className="h-full w-full overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {isEmpty ? (
              <WelcomeBlock firstName={firstName} />
            ) : (
              <div className="flex flex-col items-center pt-12 pb-40 md:pt-8">
                <div className="flex w-full max-w-4xl flex-col gap-1">
                  {messages.map((msg) => (
                    <MessageRow
                      key={msg.id}
                      message={msg}
                      userImageUrl={userImageUrl}
                      userName={userName}
                    />
                  ))}
                  {isReplying ? <AssistantTyping /> : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Gradient fade above composer */}
        <div
          aria-hidden
          className="from-background via-background/60 pointer-events-none absolute right-0 bottom-0 left-0 z-5 h-32 bg-linear-to-t to-transparent"
        />

        {/* Composer */}
        <div className="bg-background/80 absolute inset-x-0 bottom-0 z-10 mx-auto flex w-full shrink-0 justify-center px-4 pb-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl">
            <Composer
              ref={composerRef}
              input={input}
              setInput={setInput}
              files={files}
              setFiles={setFiles}
              onSubmit={handleSubmit}
              isReplying={isReplying}
              onStop={stop}
              placeholder={t("composerPlaceholder")}
              sendLabel={t("send")}
              stopLabel={t("stop")}
              attachLabel={t("attach")}
            />
          </div>
        </div>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        previewMode={previewMode}
        onDestroy={onDestroy}
      />
    </div>
  );
}

function WelcomeBlock({ firstName }: { firstName: string | null }) {
  const t = useTranslations("App.Hermes.Running");
  const greeting = firstName
    ? `${t("emptyTitle")}, ${firstName.toLowerCase()}`
    : t("emptyTitle");

  return (
    <div className="mt-[-80px] flex h-full flex-col items-start justify-center px-4 font-mono">
      <div className="mx-auto w-full max-w-2xl">
        <div className="text-tertiary-foreground mb-2 text-[11px] tracking-wide">
          ┌─[ hermes://chat ]
        </div>
        <h1 className="text-foreground flex items-baseline gap-1.5 text-2xl font-semibold tracking-tight md:text-3xl">
          <span className="text-tertiary-foreground">{">"}</span>
          <span>{greeting}</span>
          <span
            aria-hidden
            className="bg-foreground inline-block h-[0.85em] w-[0.5em] animate-pulse"
          />
        </h1>
        <p className="text-muted-foreground mt-3 ml-5 max-w-xl text-sm leading-relaxed">
          {t("emptyHint")}
        </p>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  userImageUrl,
  userName,
}: {
  message: Message;
  userImageUrl?: string | null;
  userName?: string | null;
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
          <div className="bg-muted-foreground/10 text-foreground min-h-6 rounded-lg px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
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
        <div className="text-foreground min-h-5 bg-transparent pt-1 pr-10 pb-1 text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </div>
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
  if (kind === "welcome") {
    return { icon: "👋", label: "Welcome" };
  }
  if (kind === "task_result") {
    return { icon: "📋", label: "Scheduled task" };
  }
  if (kind === "reminder") {
    return { icon: "🔔", label: "Reminder" };
  }
  // Future kinds (research_intro, daily_suggestions) will land here once
  // the orchestrator tags them properly. Until then they arrive as
  // task_result and use the 📋 chip.
  return { icon: "📨", label: "From Hermes" };
}

function AssistantTyping() {
  return (
    <div className="flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      <AssistantAvatar />
      <div className="flex min-h-5 items-center pt-2">
        <span className="reasoning-text-shine text-sm leading-5">
          Thinking…
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
  onStop: () => void;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  attachLabel: string;
}

function Composer({
  ref,
  input,
  setInput,
  files,
  setFiles,
  onSubmit,
  isReplying,
  onStop,
  placeholder,
  sendLabel,
  stopLabel,
  attachLabel,
}: ComposerProps) {
  const canSend = (input.trim().length > 0 || files.length > 0) && !isReplying;
  const status = isReplying ? "streaming" : "ready";

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
        className="border-border bg-background focus-within:border-border hover:border-muted-foreground/50 rounded-xl border transition-all duration-200"
      >
        <FileUploadDropzone
          className="data-dragging:bg-accent/20 w-full items-stretch justify-start border-0 p-0 hover:bg-transparent"
          onClick={(event) => event.preventDefault()}
        >
          <PromptInputTextarea
            ref={ref}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            disableAutoResize
            maxHeight={200}
            minHeight={44}
            autoFocus
            className="placeholder:text-muted-foreground grow resize-none border-0! bg-transparent p-4 text-base ring-0 outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
          />
        </FileUploadDropzone>

        <FileUploadList orientation="horizontal" className="gap-2 px-3 pb-1">
          {files.map((file) => (
            <FileUploadItem
              key={`${file.name}-${file.lastModified}`}
              value={file}
              className="bg-muted/40 border-border/60 flex max-w-[14rem] items-center gap-2 rounded-md border px-2 py-1.5"
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
                className="size-8 rounded-full p-0"
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
