"use client";

import { ArrowDown, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentProps,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { CHAT_MESSAGE_LIST_ATTRIBUTE } from "@/app/chat/chat-message-list";
import { highlightListMessage } from "@/app/chat/utils/room-message-highlight";
import type { TaskActivitySection } from "@/app/tasks/components/task-activity";
import {
  TaskActivityActorAvatar,
  TaskActivityEventRow,
  type TaskActivityRowContext,
  useTaskActivityActorName,
} from "@/app/tasks/components/task-activity-event-row";
import { TaskActivitySubscribeControl } from "@/app/tasks/components/task-activity-subscribe";
import { TaskStatusInline } from "@/app/tasks/components/task-status-badge";
import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import {
  getLatestTaskEventId,
  mergeTaskActivityEvents,
  TASK_ACTIVITY_MESSAGE_LIST,
} from "@/app/tasks/utils/task-activity-feed";
import { TimeAgo } from "@/components/time-ago";
import { Button } from "@/components/ui/button";
import {
  createTaskComment,
  loadOlderTaskActivityEvents,
} from "@/lib/actions/task/action";
import { Channel } from "@/lib/clients/generated/core";
import type { TaskEvent } from "@/lib/clients/generated/core/types.gen";
import { parseMentions } from "@/lib/utils/mention-parser";
import { ActivityChatComposer } from "./activity-chat-composer";
import {
  ACTIVITY_COLLAPSE_THRESHOLD,
  type ActivityVariant,
  buildActivityVariantItems,
} from "./activity-variant-feed";

type TaskActivityProps = ComponentProps<typeof TaskActivitySection>;

const STATUS_TRAIL_LIMIT = 4;
const NO_PARTICIPANTS: NonNullable<TaskActivityProps["participants"]> = [];

function FoldRow({
  events,
  onOpen,
}: {
  events: TaskEvent[];
  onOpen: () => void;
}) {
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const commentCount = events.filter((event) => event.comment != null).length;
  const statusCount = events.length - commentCount;
  const statuses = events.flatMap((event) =>
    event.comment == null && event.status ? [event.status] : [],
  );
  const trail = statuses.slice(0, STATUS_TRAIL_LIMIT);
  const label =
    commentCount === 0
      ? `Show ${events.length} status changes`
      : `Show ${events.length} earlier events`;

  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={onOpen}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex w-full items-center gap-4 rounded-lg px-3 py-1 text-left text-xs transition-colors outline-none focus-visible:ring-2"
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <ChevronsUpDown className="size-3.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="text-foreground text-sm font-medium">{label}</span>
        {commentCount === 0 ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {trail.map((status, index) => (
              <span
                key={`${status}-${index}`}
                className="inline-flex items-center gap-1.5"
              >
                {index > 0 ? <span aria-hidden>→</span> : null}
                <TaskStatusInline status={status} label={tStatus(status)} />
              </span>
            ))}
            {statuses.length > trail.length ? (
              <span>+{statuses.length - trail.length}</span>
            ) : null}
          </span>
        ) : (
          <span>
            · {commentCount} {commentCount === 1 ? "comment" : "comments"},{" "}
            {statusCount} status {statusCount === 1 ? "change" : "changes"}
          </span>
        )}
      </span>
    </button>
  );
}

const MARKDOWN_NOISE = /[#*_`>~[\]]|\(https?:[^)]*\)/g;

function CompactCommentRow({
  event,
  context,
  onOpen,
}: {
  event: TaskEvent;
  context: TaskActivityRowContext;
  onOpen: () => void;
}) {
  const { actorName, actorInfo } = useTaskActivityActorName(event, context);
  const preview = (event.comment ?? "")
    .replace(MARKDOWN_NOISE, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <button
      type="button"
      aria-expanded={false}
      aria-label={`Show comment from ${actorName}`}
      data-message-id={event.id}
      onClick={onOpen}
      className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-4 rounded-lg px-3 py-1.5 text-left transition-colors outline-none focus-visible:ring-2"
    >
      <TaskActivityActorAvatar
        event={event}
        actorName={actorName}
        actorInfo={actorInfo}
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 text-sm font-medium">{actorName}</span>
        <span className="text-muted-foreground min-w-0 truncate text-sm">
          {preview}
        </span>
      </span>
      <TimeAgo
        date={event.createdAt}
        className="text-muted-foreground shrink-0 text-xs whitespace-nowrap"
      />
    </button>
  );
}

function jumpToEvent(eventId: string | null) {
  if (eventId) {
    highlightListMessage(TASK_ACTIVITY_MESSAGE_LIST, eventId);
  }
}

/**
 * Chat's own control: a zero-height sticky line under the feed, so the pill
 * hangs over the bottom of the scroller while the newest row is out of view.
 */
function FloatingJumpToLatest({ latestEventId }: { latestEventId: string }) {
  const t = useTranslations("App.Tasks.Detail");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [isBelowView, setIsBelowView] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setIsBelowView(
        !entry.isIntersecting &&
          entry.boundingClientRect.top > (entry.rootBounds?.bottom ?? 0),
      );
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {isBelowView ? (
        <div className="pointer-events-none sticky bottom-4 z-10 h-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-primary border-primary-tertiary bg-background hover:bg-primary-quaternary hover:text-foreground dark:bg-background dark:hover:bg-primary-quaternary pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full shadow-md"
            onClick={() => jumpToEvent(latestEventId)}
          >
            <ArrowDown aria-hidden />
            {t("jumpToRecent")}
          </Button>
        </div>
      ) : null}
      <div ref={sentinelRef} aria-hidden className="h-px" />
    </>
  );
}

export function TaskActivityVariantSection({
  variant,
  ...props
}: TaskActivityProps & { variant: ActivityVariant }) {
  const {
    taskId,
    title,
    placeholder,
    submitLabel,
    events,
    commentCount = 0,
    currentUser,
    canComment = true,
    mentionableUsers = [],
    participants = NO_PARTICIPANTS,
  } = props;
  const t = useTranslations("App.Tasks.Detail");
  const router = useRouter();
  const [isSending, startSending] = useTransition();
  const [localEvents, setLocalEvents] = useState<TaskEvent[]>(events);
  const [openedFolds, setOpenedFolds] = useState<Set<string>>(new Set());
  const [openedComments, setOpenedComments] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLocalEvents((prev) =>
      mergeTaskActivityEvents(
        prev.filter((event) => !event.id.startsWith("optimistic:")),
        events,
      ),
    );
  }, [events]);

  // The page trims older comments; each structure needs the whole thread.
  const oldestLoadedCommentId =
    events.find((event) => event.comment != null)?.id ?? null;
  const loadedCommentCount = events.filter(
    (event) => event.comment != null,
  ).length;
  const needsOlder =
    oldestLoadedCommentId != null && commentCount > loadedCommentCount;
  useEffect(() => {
    if (!needsOlder || !oldestLoadedCommentId) {
      return;
    }
    let cancelled = false;
    void loadOlderTaskActivityEvents({
      taskId,
      untilEventId: oldestLoadedCommentId,
    }).then((result) => {
      if (!cancelled && result.ok) {
        setLocalEvents((prev) => mergeTaskActivityEvents(prev, result.value));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [needsOlder, oldestLoadedCommentId, taskId]);

  const viewerId = currentUser?.id;
  const agentNameById = useMemo(
    () => props.agentNameById ?? new Map<string, string>(),
    [props.agentNameById],
  );
  const mentions = useMemo(
    () => ({
      ...convertAgentNamesToMentionOptions(agentNameById),
      ...Object.fromEntries(
        mentionableUsers
          .filter((user) => user.id !== viewerId)
          .map((user) => [user.id, { value: user.name }]),
      ),
    }),
    [agentNameById, mentionableUsers, viewerId],
  );
  const mentionUserNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const [id, actor] of Object.entries(props.userById ?? {})) {
      names.set(id, actor.name);
    }
    for (const user of mentionableUsers) {
      if (user.id !== viewerId) names.set(user.id, user.name);
    }
    return names;
  }, [props.userById, mentionableUsers, viewerId]);

  const latestEventId = getLatestTaskEventId(localEvents);
  const rowContext: TaskActivityRowContext = {
    actorCoworkerLabel: props.actorCoworkerLabel,
    actorUserLabel: props.actorUserLabel,
    actorSokoBotLabel: props.actorSokoBotLabel,
    actorSystemLabel: props.actorSystemLabel,
    actionCommentedLabel: props.actionCommentedLabel,
    actionUpdatedStatusLabel: props.actionUpdatedStatusLabel,
    expandLabel: props.expandLabel ?? "Expand",
    collapseLabel: props.collapseLabel ?? "Show less",
    latestEventId,
    taskFiles: props.taskFiles,
    agentNameById,
    mentionUserNameById,
    userById: props.userById,
    coworkerById: props.coworkerById,
    sokoBotById: props.sokoBotById,
    viewerPlan: props.viewerPlan ?? null,
  };

  const items = buildActivityVariantItems(variant, localEvents, {
    openedFolds,
    openedComments,
  });
  const isCollapsible = localEvents.length > ACTIVITY_COLLAPSE_THRESHOLD;
  const jumpInHeader = variant !== "status-folds" && isCollapsible;

  function handleSend(markdown: string) {
    if (!currentUser) {
      return;
    }
    const now = new Date();
    const optimisticEvent: TaskEvent = {
      id: `optimistic:${now.getTime()}`,
      createdAt: now,
      updatedAt: now,
      taskId,
      status: null,
      comment: markdown,
      authenticationUrl: null,
      channel: Channel.SOKOSUMI,
      origin: Channel.SOKOSUMI,
      actor: {
        type: "user",
        id: currentUser.id,
        user: {
          id: currentUser.id,
          name: currentUser.name,
          image: currentUser.image,
        },
      },
      userId: currentUser.id,
      user: {
        id: currentUser.id,
        name: currentUser.name,
        image: currentUser.image,
      },
      coworkerId: null,
      transactionId: null,
      credits: null,
    };
    const memberIds = new Set(
      mentionableUsers
        .filter((user) => user.id !== viewerId)
        .map((user) => user.id),
    );
    const mentionedUserIds = [
      ...new Set(
        parseMentions(markdown)
          .map((mention) => mention.id)
          .filter((id) => memberIds.has(id)),
      ),
    ];
    setLocalEvents((prev) => [...prev, optimisticEvent]);
    startSending(async () => {
      try {
        await createTaskComment({
          taskId,
          comment: markdown,
          mentionedUserIds,
        });
        router.refresh();
      } catch {
        setLocalEvents((prev) =>
          prev.filter((entry) => entry.id !== optimisticEvent.id),
        );
      }
    });
  }

  return (
    <section className="space-y-4" data-activity-variant={variant}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
        <div className="flex items-center gap-1">
          {jumpInHeader ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-7 gap-1 px-2 text-xs"
              onClick={() => jumpToEvent(latestEventId)}
            >
              <ArrowDown className="size-3.5" aria-hidden />
              {t("jumpToRecent")}
            </Button>
          ) : null}
          <TaskActivitySubscribeControl
            taskId={taskId}
            viewerId={currentUser?.id ?? null}
            viewerName={currentUser?.name ?? null}
            viewerImage={currentUser?.image ?? null}
            participants={participants}
            canComment={canComment}
          />
        </div>
      </div>

      {items.length > 0 ? (
        <div
          className="space-y-3"
          {...{ [CHAT_MESSAGE_LIST_ATTRIBUTE]: TASK_ACTIVITY_MESSAGE_LIST }}
        >
          {items.map((item) => {
            if (item.type === "fold") {
              return (
                <FoldRow
                  key={`fold-${item.id}`}
                  events={item.events}
                  onOpen={() =>
                    setOpenedFolds((prev) => new Set(prev).add(item.id))
                  }
                />
              );
            }
            if (item.compact) {
              return (
                <CompactCommentRow
                  key={item.event.id}
                  event={item.event}
                  context={rowContext}
                  onOpen={() =>
                    setOpenedComments((prev) =>
                      new Set(prev).add(item.event.id),
                    )
                  }
                />
              );
            }
            return (
              <TaskActivityEventRow
                key={item.event.id}
                event={item.event}
                context={rowContext}
              />
            );
          })}
        </div>
      ) : null}

      {variant === "status-folds" && latestEventId ? (
        <FloatingJumpToLatest latestEventId={latestEventId} />
      ) : null}

      {canComment ? (
        <ActivityChatComposer
          taskId={taskId}
          placeholder={placeholder}
          sendLabel={submitLabel}
          mentions={mentions}
          sendDisabled={!currentUser}
          isSending={isSending}
          onSend={handleSend}
        />
      ) : null}
    </section>
  );
}
