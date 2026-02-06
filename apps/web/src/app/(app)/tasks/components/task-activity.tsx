"use client";

import { TaskEventOrigin } from "@sokosumi/database";
import { ArrowUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createTaskComment } from "@/lib/actions/task/action";
import { TaskEvent } from "@/lib/types/task";
import { formatShortDate } from "@/lib/utils/datetime";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";

import { ExpandableMarkdown } from "./expandable-markdown";

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
  attachLabel,
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
  const resolvedAgentNameById = agentNameById ?? new Map<string, string>();
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [isPending, startTransition] = useTransition();
  const [localEvents, setLocalEvents] = useState<TaskEvent[]>(events);

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
      <h2 className="text-xs font-medium text-muted-foreground/60">{title}</h2>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-border/50 p-3"
      >
        <Textarea
          placeholder={placeholder}
          className="min-h-16 resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-sm"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <div className="mt-2 flex items-center justify-end">
          <Button
            size="icon"
            className="rounded-full size-7"
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
          {orderedEvents.map((event) => {
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
            const isNewOptimisticEvent = isNewOptimisticEventId(event.id);
            const formattedComment = event.comment
              ? formatMentionsAsMarkdownLinks(
                  event.comment,
                  resolvedAgentNameById,
                )
              : null;

            const row = (
              <div key={event.id} className="flex items-start gap-3">
                <Avatar className="size-6 shrink-0">
                  {actorImage ? (
                    <AvatarImage src={actorImage} alt={actorName} />
                  ) : null}
                  <AvatarFallback className="text-[10px] bg-muted">
                    {getInitials(actorName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                  <div className="flex flex-row items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
                      <span className="font-medium text-sm">{actorName}</span>
                      <span className="text-muted-foreground/60 text-xs">{action}</span>
                      {event.status && (
                        <span className="text-xs font-medium text-foreground/70">
                          {event.status}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground/40 text-xs whitespace-nowrap">
                      {formatShortDate(event.createdAt)}
                    </span>
                  </div>
                  {formattedComment ? (
                    <ExpandableMarkdown
                      content={formattedComment}
                      className="prose-sm text-foreground/70 text-sm"
                      expandLabel={expandLabel}
                      collapseLabel={collapseLabel}
                      fadeClassName="to-background"
                    />
                  ) : null}
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
