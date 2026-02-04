"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import Markdown from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createTaskComment } from "@/lib/actions/task/action";
import { TaskEvent } from "@/lib/types/task";
import { formatShortDate } from "@/lib/utils/datetime";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";

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
  events: TaskEvent[];
  agentNameById?: Map<string, string>;
  userById?: Record<string, ActorInfo>;
  orchestratorById?: Record<string, ActorInfo>;
  currentUser?: ({ id: string } & ActorInfo) | null;
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
  events,
  agentNameById,
  userById,
  orchestratorById,
  currentUser,
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
      userId: currentUser?.id ?? null,
      orchestratorId: null,
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
    <div className="space-y-4">
      <h2 className="text-primary text-lg font-semibold">{title}</h2>

      <form
        onSubmit={handleSubmit}
        className="bg-muted/40 rounded-xl border p-3"
      >
        <Textarea
          placeholder={placeholder}
          className="min-h-24 resize-none"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <div className="mt-2 flex items-center justify-end gap-4">
          {/* TODO: Add file attachment */}
          {/* <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={attachLabel}
            type="button"
            disabled={isPending}
          >
            <Paperclip className="size-4" aria-hidden />
          </Button> */}
          <Button
            size="icon"
            variant="primary"
            className="rounded-full"
            aria-label={submitLabel}
            type="submit"
            disabled={isSubmitDisabled}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </form>

      <div className="space-y-4">
        {orderedEvents.map((event) => {
          const actorLabel = event.orchestratorId
            ? "Orchestrator"
            : event.userId
              ? "User"
              : "System";
          const actorInfo = event.orchestratorId
            ? orchestratorById?.[event.orchestratorId]
            : event.userId
              ? userById?.[event.userId]
              : undefined;
          const actorName = actorInfo?.name ?? actorLabel;
          const actorImage = actorInfo?.image ?? null;
          const action = event.comment ? "commented" : "updated status";
          const isNewOptimisticEvent = isNewOptimisticEventId(event.id);
          const formattedComment = event.comment
            ? formatMentionsAsMarkdownLinks(
                event.comment,
                resolvedAgentNameById,
              )
            : null;

          const row = (
            <div
              key={event.id}
              className="bg-muted/30 flex items-start gap-3 rounded-lg px-3 py-2"
            >
              <Avatar className="size-9">
                {actorImage ? (
                  <AvatarImage src={actorImage} alt={actorName} />
                ) : null}
                <AvatarFallback>{getInitials(actorName)}</AvatarFallback>
              </Avatar>
              <div className="flex w-full flex-col gap-1">
                <div className="flex flex-row items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{actorName}</span>
                    <span className="text-muted-foreground">{action}</span>
                    {event.status && (
                      <span className="text-primary font-semibold">
                        {event.status}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {formatShortDate(event.createdAt)}
                  </span>
                </div>
                {formattedComment ? (
                  <Markdown className="prose-sm text-muted-foreground">
                    {formattedComment}
                  </Markdown>
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
    </div>
  );
}
