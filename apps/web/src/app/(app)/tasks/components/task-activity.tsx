"use client";

import { BlobStatus, TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { ArrowUp, Command, CornerDownLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { SourcesGrid } from "@/components/sources/sources-grid";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useOSDetection } from "@/hooks/use-os-detection";
import { createTaskComment } from "@/lib/actions/task/action";
import {
  ORIGIN_APP_NAME_KEY_MAP,
  ORIGIN_ICON_MAP,
} from "@/lib/constants/task-event-origin-icons";
import {
  extractFileLikeLinks,
  extractHttpLinks,
} from "@/lib/data/markdown/links";
import type { TaskEvent } from "@/lib/types/task";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/utils/datetime";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";

import { ExpandableMarkdown } from "./expandable-markdown";
import {
  getTaskStatusDotColorClass,
  TaskStatusBadge,
} from "./task-status-badge";

interface ActorInfo {
  name: string;
  image: string | null;
}

interface TaskActivityProps {
  taskId: string;
  title: string;
  placeholder: string;
  attachLabel: string;
  submitLabel: string;
  actorCoworkerLabel: string;
  actorUserLabel: string;
  actorSystemLabel: string;
  actionCommentedLabel: string;
  actionUpdatedStatusLabel: string;
  events: TaskEvent[];
  agentNameById?: Map<string, string>;
  userById?: Record<string, ActorInfo>;
  coworkerById?: Record<string, ActorInfo>;
  currentUser?: ({ id: string } & ActorInfo) | null;
  expandLabel?: string;
  collapseLabel?: string;
}

function getInitials(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return "?";
  }

  return trimmedName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getEventTimestamp(event: TaskEvent): number {
  return new Date(event.createdAt).getTime();
}

function isNewOptimisticEventId(id: string): boolean {
  return id.startsWith("optimistic:");
}

function getFileNameFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname.split("/").pop() ?? null;
  } catch {
    return url.split("/").pop() ?? null;
  }
}

function AnimatedNewRow({ children }: { children: ReactNode }) {
  const [isEntered, setIsEntered] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsEntered(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={[
        "overflow-hidden",
        "transition-[max-height,opacity,transform]",
        "duration-300",
        "ease-out",
        "motion-reduce:transition-none",
        isEntered
          ? "max-h-[600px] translate-y-0 opacity-100"
          : "max-h-0 -translate-y-2 opacity-0",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function TaskActivitySection({
  taskId,
  title,
  placeholder,
  attachLabel: _attachLabel,
  submitLabel,
  actorCoworkerLabel,
  actorUserLabel,
  actorSystemLabel,
  actionCommentedLabel,
  actionUpdatedStatusLabel,
  events,
  agentNameById,
  userById,
  coworkerById,
  currentUser,
  expandLabel = "Expand",
  collapseLabel = "Show less",
}: TaskActivityProps) {
  const t = useTranslations("App.Tasks.Detail");
  const resolvedAgentNameById = agentNameById ?? new Map<string, string>();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [comment, setComment] = useState("");
  const [isPending, startTransition] = useTransition();
  const [localEvents, setLocalEvents] = useState<TaskEvent[]>(events);
  const { os, isMobile } = useOSDetection();

  useEffect(() => {
    setLocalEvents(events);
  }, [events]);

  const orderedEvents = useMemo(() => {
    return [...localEvents].sort(
      (a, b) => getEventTimestamp(b) - getEventTimestamp(a),
    );
  }, [localEvents]);

  const trimmedComment = comment.trim();
  const isSubmitDisabled =
    isPending || trimmedComment.length === 0 || !currentUser?.id;

  function handleTextareaKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key !== "Enter") {
      return;
    }

    const isSubmitCombo = event.metaKey || event.ctrlKey;
    if (!isSubmitCombo || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();

    if (isSubmitDisabled) {
      return;
    }

    formRef.current?.requestSubmit();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    const optimisticEvent: TaskEvent = {
      id: `optimistic:${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      taskId,
      status: null,
      comment: trimmedComment,
      authenticationUrl: null,
      origin: TaskEventOrigin.SOKOSUMI,
      userId: currentUser?.id ?? null,
      coworkerId: null,
      transactionId: null,
    };

    setLocalEvents((prev) => [optimisticEvent, ...prev]);
    setComment("");

    startTransition(() => {
      void (async () => {
        try {
          await createTaskComment({
            taskId,
            comment: trimmedComment,
          });
          router.refresh();
        } catch {
          setLocalEvents((prev) =>
            prev.filter((entry) => entry.id !== optimisticEvent.id),
          );
          setComment(trimmedComment);
        }
      })();
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="border-border/50 rounded-lg border p-3"
      >
        <Textarea
          placeholder={placeholder}
          className="min-h-16 resize-none border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={handleTextareaKeyDown}
        />
        <div className="mt-2 flex items-center gap-3">
          {!isMobile ? (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span>{t("sendWith")}</span>
              <div className="flex items-center gap-0.5 opacity-60">
                {os === "MacOS" ? (
                  <Command className="size-3" aria-hidden />
                ) : (
                  <span className="text-xs">{t("ctrl")}</span>
                )}
                <CornerDownLeft className="size-3" aria-hidden />
              </div>
            </div>
          ) : null}
          <Button
            size="icon"
            className="ml-auto size-7 rounded-full"
            aria-label={submitLabel}
            type="submit"
            disabled={isSubmitDisabled}
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-3.5" aria-hidden />
            )}
          </Button>
        </div>
      </form>

      {orderedEvents.length > 0 ? (
        <div className="space-y-3">
          {orderedEvents.map((event, index) => {
            const actorLabel = event.coworkerId
              ? actorCoworkerLabel
              : event.userId
                ? actorUserLabel
                : actorSystemLabel;
            const actorInfo = event.coworkerId
              ? coworkerById?.[event.coworkerId]
              : event.userId
                ? userById?.[event.userId]
                : undefined;
            const actorName = actorInfo?.name ?? actorLabel;
            const actorImage = actorInfo?.image ?? null;
            const action = event.comment
              ? actionCommentedLabel
              : actionUpdatedStatusLabel;
            const OriginIcon = ORIGIN_ICON_MAP[event.origin];
            const originAppName = t(
              `originApp.${ORIGIN_APP_NAME_KEY_MAP[event.origin]}`,
            );
            const originFromLabel = t("originFromApp", {
              appName: originAppName,
            });
            const isNewOptimisticEvent = isNewOptimisticEventId(event.id);
            const formattedComment = event.comment
              ? formatMentionsAsMarkdownLinks(
                  event.comment,
                  resolvedAgentNameById,
                )
              : null;
            const sourceFiles = formattedComment
              ? extractFileLikeLinks(formattedComment).map(
                  (url, fileIndex) => ({
                    id: `${event.id}-file-${fileIndex}`,
                    sourceUrl: url,
                    fileUrl: url,
                    name: getFileNameFromUrl(url),
                    status: BlobStatus.READY,
                  }),
                )
              : [];
            const sourceLinks = formattedComment
              ? extractHttpLinks(formattedComment).map((url, linkIndex) => ({
                  id: `${event.id}-link-${linkIndex}`,
                  url,
                }))
              : [];
            const hasCommentSources =
              sourceFiles.length > 0 || sourceLinks.length > 0;
            const chargedLabel =
              event.credits != null
                ? t("actionChargedCredits", { credits: event.credits })
                : null;
            const shouldShowAuthenticateButton =
              index === 0 &&
              event.status === TaskStatus.AUTHENTICATION_REQUIRED &&
              Boolean(event.authenticationUrl);
            const isCommentEvent = Boolean(formattedComment);
            const isAuthEvent = shouldShowAuthenticateButton;
            const isCardEvent = isCommentEvent || isAuthEvent;
            const isStatusOnlyEvent = !isCardEvent && Boolean(event.status);

            const row = (
              <div
                key={event.id}
                className={cn(
                  "rounded-lg pr-3 pl-3",
                  isCardEvent && "bg-muted/20 border-border/50 border",
                )}
              >
                <div
                  className={cn(
                    "flex items-center gap-4",
                    isCardEvent && "py-3",
                  )}
                >
                  {isStatusOnlyEvent && event.status ? (
                    <div className="flex size-6 shrink-0 items-center justify-center">
                      <span
                        data-testid={`status-dot-${event.id}`}
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          getTaskStatusDotColorClass(event.status),
                        )}
                        aria-hidden
                      />
                    </div>
                  ) : (
                    <Avatar className="size-6 shrink-0 self-start">
                      {actorImage ? (
                        <AvatarImage src={actorImage} alt={actorName} />
                      ) : null}
                      <AvatarFallback className="bg-muted text-[10px]">
                        {getInitials(actorName)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-row items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
                        <span className="text-sm font-medium">{actorName}</span>
                        <span className="text-muted-foreground/60 inline-flex items-center gap-1 text-xs">
                          <span>{action}</span>
                          <span>{originFromLabel}</span>
                          <OriginIcon
                            className="text-muted-foreground/50 size-3.5 shrink-0"
                            role="img"
                            aria-label={originFromLabel}
                            data-testid={`origin-icon-${event.id}`}
                          />
                        </span>
                        {event.status ? (
                          <TaskStatusBadge
                            status={event.status}
                            showDot={!isStatusOnlyEvent}
                          />
                        ) : null}
                      </div>
                      <span className="text-muted-foreground/40 text-xs whitespace-nowrap">
                        {formatTimeAgo(event.createdAt)}
                      </span>
                    </div>
                    {formattedComment ? (
                      <ExpandableMarkdown
                        content={formattedComment}
                        className="prose-sm text-foreground/70 text-sm"
                        expandLabel={expandLabel}
                        collapseLabel={collapseLabel}
                        fadeClassName="to-transparent"
                      />
                    ) : null}
                    {hasCommentSources ? (
                      <div className="space-y-1.5">
                        <Separator className="my-3" />
                        {sourceFiles.length > 0 ? (
                          <SourcesGrid
                            title={t("sourcesFiles")}
                            blobs={sourceFiles}
                            className="mt-0"
                          />
                        ) : null}
                        {sourceLinks.length > 0 ? (
                          <SourcesGrid
                            title={t("sourcesLinks")}
                            links={sourceLinks}
                            className="mt-0"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {shouldShowAuthenticateButton ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button asChild size="sm" variant="default">
                          <a
                            href={event.authenticationUrl ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("authenticate")}
                          </a>
                        </Button>
                      </div>
                    ) : null}
                    {chargedLabel ? (
                      <div className="text-muted-foreground/60 text-xs">
                        {chargedLabel}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );

            return isNewOptimisticEvent ? (
              <AnimatedNewRow key={event.id}>{row}</AnimatedNewRow>
            ) : (
              row
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
