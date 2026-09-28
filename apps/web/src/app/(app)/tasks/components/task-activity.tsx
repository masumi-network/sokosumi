"use client";

import type { SubscriptionPlanName } from "@sokosumi/utils";
import { ArrowDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { CHAT_MESSAGE_LIST_ATTRIBUTE } from "@/app/chat/chat-message-list";
import { highlightListMessage } from "@/app/chat/utils/room-message-highlight";
import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import type { TaskActivityActorInfo } from "@/app/tasks/utils/task-activity-actors";
import {
  buildTaskActivityFeedItems,
  getLatestTaskEventId,
  mergeTaskActivityEvents,
  TASK_ACTIVITY_COLLAPSE_THRESHOLD,
  TASK_ACTIVITY_MESSAGE_LIST,
  type TaskActivityFeedItem,
} from "@/app/tasks/utils/task-activity-feed";
import { Button } from "@/components/ui/button";
import { createTaskComment } from "@/lib/actions/task/action";
import { Channel } from "@/lib/clients/generated/core";
import type {
  TaskEvent,
  TaskFile,
  TaskParticipant,
} from "@/lib/clients/generated/core/types.gen";
import { parseMentions } from "@/lib/utils/mention-parser";
import { TaskActivityComposer } from "./task-activity-composer";
import {
  TaskActivityCompactCommentRow,
  TaskActivityEventRow,
  type TaskActivityRowContext,
  TaskActivityStatusFoldRow,
} from "./task-activity-event-row";
import { TaskActivitySubscribeControl } from "./task-activity-subscribe";

interface TaskActivityProps {
  taskId: string;
  title: string;
  placeholder: string;
  submitLabel: string;
  actorCoworkerLabel: string;
  actorUserLabel: string;
  actorSokoBotLabel: string;
  actorSystemLabel: string;
  actionCommentedLabel: string;
  actionUpdatedStatusLabel: string;
  /** Every event on the Task; older ones collapse in place, never off the page. */
  events: TaskEvent[];
  taskFiles: TaskFile[];
  agentNameById?: Map<string, string>;
  userById?: Record<string, TaskActivityActorInfo>;
  coworkerById?: Record<string, TaskActivityActorInfo>;
  sokoBotById?: Record<string, TaskActivityActorInfo>;
  currentUser?: ({ id: string } & TaskActivityActorInfo) | null;
  expandLabel?: string;
  collapseLabel?: string;
  /**
   * Viewer's subscription plan for out-of-credits billing CTAs.
   * `null` when the plan is unavailable (admin/read-only, membership miss) —
   * show status copy but no billing link for the viewer.
   */
  viewerPlan?: SubscriptionPlanName | null;
  canComment?: boolean;
  /** Workspace members the composer offers for `@`; mentions add them as Task participants. */
  mentionableUsers?: readonly MentionableUser[];
  /** Task participants in join order. */
  participants?: TaskParticipant[];
}

export interface MentionableUser {
  id: string;
  name: string;
}

const NO_MENTIONABLE_USERS: readonly MentionableUser[] = [];
const NO_PARTICIPANTS: TaskParticipant[] = [];

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

function feedItemKey(item: TaskActivityFeedItem): string {
  return item.type === "status-fold" ? `fold-${item.id}` : item.event.id;
}

interface FeedSegment {
  light: boolean;
  items: TaskActivityFeedItem[];
}

/**
 * One-liners, folds and bare status changes sit in tight runs so the cards
 * between them carry the page's weight.
 */
function groupLightItems(
  items: TaskActivityFeedItem[],
  latestEventId: string | null,
): FeedSegment[] {
  const segments: FeedSegment[] = [];
  for (const item of items) {
    const light =
      item.type === "status-fold" ||
      item.compact ||
      (item.event.comment == null && item.event.id !== latestEventId);
    const previous = segments.at(-1);
    if (light && previous?.light) {
      previous.items.push(item);
    } else {
      segments.push({ light, items: [item] });
    }
  }
  return segments;
}

export function TaskActivitySection({
  taskId,
  title,
  placeholder,
  submitLabel,
  actorCoworkerLabel,
  actorUserLabel,
  actorSokoBotLabel,
  actorSystemLabel,
  actionCommentedLabel,
  actionUpdatedStatusLabel,
  events,
  taskFiles,
  agentNameById,
  userById,
  coworkerById,
  sokoBotById,
  currentUser,
  expandLabel = "Expand",
  collapseLabel = "Show less",
  viewerPlan = null,
  canComment = true,
  mentionableUsers = NO_MENTIONABLE_USERS,
  participants = NO_PARTICIPANTS,
}: TaskActivityProps) {
  const t = useTranslations("App.Tasks.Detail");
  const resolvedAgentNameById = useMemo(
    () => agentNameById ?? new Map<string, string>(),
    [agentNameById],
  );
  const router = useRouter();
  const [isSending, startSending] = useTransition();
  const [localEvents, setLocalEvents] = useState<TaskEvent[]>(events);
  const [openedFolds, setOpenedFolds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [openedComments, setOpenedComments] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Match chat and Core `excludeUserId`: @ of yourself does not enroll the writer.
  const viewerId = currentUser?.id;
  const mentionOptions = useMemo(() => {
    const humans =
      viewerId == null
        ? mentionableUsers
        : mentionableUsers.filter((user) => user.id !== viewerId);
    return {
      ...convertAgentNamesToMentionOptions(resolvedAgentNameById),
      ...Object.fromEntries(
        humans.map((user) => [user.id, { value: user.name }]),
      ),
    };
  }, [resolvedAgentNameById, mentionableUsers, viewerId]);
  const mentionUserNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const [id, actor] of Object.entries(userById ?? {})) {
      names.set(id, actor.name);
    }
    for (const user of mentionableUsers) {
      if (viewerId != null && user.id === viewerId) continue;
      names.set(user.id, user.name);
    }
    return names;
  }, [userById, mentionableUsers, viewerId]);

  useEffect(() => {
    // Same task: keep optimistic rows out; the refreshed prop carries the
    // persisted event. Different task: replace the feed entirely.
    setLocalEvents((prev) => {
      const sameTask =
        prev.length > 0 && prev.every((event) => event.taskId === taskId);
      if (!sameTask) {
        return events;
      }
      return mergeTaskActivityEvents(
        prev.filter((event) => !isNewOptimisticEventId(event.id)),
        events,
      );
    });
  }, [events, taskId]);

  const latestEventId = getLatestTaskEventId(localEvents);
  const segments = useMemo(
    () =>
      groupLightItems(
        buildTaskActivityFeedItems(localEvents, {
          openedFolds,
          openedComments,
        }),
        latestEventId,
      ),
    [localEvents, openedFolds, openedComments, latestEventId],
  );
  const rowContext = useMemo<TaskActivityRowContext>(
    () => ({
      actorCoworkerLabel,
      actorUserLabel,
      actorSokoBotLabel,
      actorSystemLabel,
      actionCommentedLabel,
      actionUpdatedStatusLabel,
      expandLabel,
      collapseLabel,
      latestEventId,
      taskFiles,
      agentNameById: resolvedAgentNameById,
      mentionUserNameById,
      userById,
      coworkerById,
      sokoBotById,
      viewerPlan,
    }),
    [
      actorCoworkerLabel,
      actorUserLabel,
      actorSokoBotLabel,
      actorSystemLabel,
      actionCommentedLabel,
      actionUpdatedStatusLabel,
      expandLabel,
      collapseLabel,
      latestEventId,
      taskFiles,
      resolvedAgentNameById,
      mentionUserNameById,
      userById,
      coworkerById,
      sokoBotById,
      viewerPlan,
    ],
  );
  const showJumpToLatest =
    latestEventId != null &&
    localEvents.length > TASK_ACTIVITY_COLLAPSE_THRESHOLD;

  function handleSend(comment: string): Promise<boolean> {
    const optimisticEvent: TaskEvent = {
      id: `optimistic:${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      taskId,
      status: null,
      comment,
      authenticationUrl: null,
      channel: Channel.SOKOSUMI,
      origin: Channel.SOKOSUMI,
      actor: currentUser
        ? {
            type: "user",
            id: currentUser.id,
            user: {
              id: currentUser.id,
              name: currentUser.name,
              image: currentUser.image,
            },
          }
        : null,
      userId: currentUser?.id ?? null,
      user: currentUser
        ? {
            id: currentUser.id,
            name: currentUser.name,
            image: currentUser.image,
          }
        : null,
      coworkerId: null,
      transactionId: null,
      credits: null,
    };

    const memberIds = new Set(
      mentionableUsers
        .filter((user) => viewerId == null || user.id !== viewerId)
        .map((user) => user.id),
    );
    const mentionedUserIds = [
      ...new Set(
        parseMentions(comment)
          .map((mention) => mention.id)
          .filter((id) => memberIds.has(id)),
      ),
    ];

    setLocalEvents((prev) => [...prev, optimisticEvent]);

    return new Promise((resolve) => {
      startSending(async () => {
        try {
          await createTaskComment({ taskId, comment, mentionedUserIds });
          router.refresh();
          resolve(true);
        } catch {
          setLocalEvents((prev) =>
            prev.filter((entry) => entry.id !== optimisticEvent.id),
          );
          resolve(false);
        }
      });
    });
  }

  function renderItem(item: TaskActivityFeedItem) {
    if (item.type === "status-fold") {
      return (
        <TaskActivityStatusFoldRow
          key={feedItemKey(item)}
          events={item.events}
          onOpen={() => setOpenedFolds((prev) => new Set(prev).add(item.id))}
        />
      );
    }
    if (item.compact) {
      return (
        <TaskActivityCompactCommentRow
          key={feedItemKey(item)}
          event={item.event}
          context={rowContext}
          onOpen={() =>
            setOpenedComments((prev) => new Set(prev).add(item.event.id))
          }
        />
      );
    }
    const row = (
      <TaskActivityEventRow
        key={feedItemKey(item)}
        event={item.event}
        context={rowContext}
      />
    );
    return isNewOptimisticEventId(item.event.id) ? (
      <AnimatedNewRow key={feedItemKey(item)}>{row}</AnimatedNewRow>
    ) : (
      row
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
        <div className="flex items-center gap-1">
          {showJumpToLatest ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-7 gap-1 px-2 text-xs"
              onClick={() =>
                highlightListMessage(TASK_ACTIVITY_MESSAGE_LIST, latestEventId)
              }
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

      {segments.length > 0 ? (
        <div
          className="space-y-3"
          {...{ [CHAT_MESSAGE_LIST_ATTRIBUTE]: TASK_ACTIVITY_MESSAGE_LIST }}
        >
          {segments.map((segment) => {
            const first = segment.items[0];
            if (!first) {
              return null;
            }
            if (!segment.light) {
              return renderItem(first);
            }
            return (
              <div key={`group-${feedItemKey(first)}`} className="space-y-1">
                {segment.items.map((item) =>
                  item.type === "event" && !item.compact ? (
                    <div
                      key={feedItemKey(item)}
                      className="flex min-h-8 flex-col justify-center"
                    >
                      {renderItem(item)}
                    </div>
                  ) : (
                    renderItem(item)
                  ),
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {canComment ? (
        <TaskActivityComposer
          taskId={taskId}
          placeholder={placeholder}
          submitLabel={submitLabel}
          mentions={mentionOptions}
          sendDisabled={!currentUser?.id}
          isSending={isSending}
          onSend={handleSend}
        />
      ) : null}
    </section>
  );
}
