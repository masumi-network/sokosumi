"use client";

import { type TaskListItem, TaskStatus } from "@sokosumi/core-client";
import { makeUserTasksChannelName } from "@sokosumi/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChannel } from "ably/react";
import { Send } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { getTaskStatusMarker } from "@/app/tasks/components/task-status-badge";
import { taskHref } from "@/app/tasks/utils/task-href";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusMarker } from "@/components/ui/status-marker";
import { Textarea } from "@/components/ui/textarea";
import { getRealtimeChannelEnvironment } from "@/lib/ably/realtime-channel-environment";
import { createTaskComment } from "@/lib/actions/task/action";
import { useSession } from "@/lib/auth/auth.client";
import { coreClient } from "@/lib/clients/core.browser.client";
import { cn } from "@/lib/utils";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";
import {
  isCurrentWait,
  NEEDS_YOU_TASKS_QUERY_KEY,
  needsYouTasksQueryOptions,
  waitingQuestion,
} from "@/queries/needs-you-tasks";

/** The Tasks waiting on the reader, shared by the tab count and the rows. */
export function useNeedsYouTasks() {
  const { data: session } = useSession();

  return useQuery(
    needsYouTasksQueryOptions(
      session?.user.id,
      session?.session.activeOrganizationId ?? null,
    ),
  );
}

/**
 * Reads the waiting Tasks again whenever one of the reader's Tasks changes:
 * an answer given on the Task's page, an agent asking again, a Task done.
 * Core publishes each to the reader's Task channel. Mounted under the
 * Notification Center's realtime island, so a list that stays open, and the
 * tab's number, follow along without a reload.
 */
export function NeedsYouTasksRealtimeRefresh({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  useChannel(
    makeUserTasksChannelName(userId, getRealtimeChannelEnvironment()),
    () => {
      void queryClient.invalidateQueries({
        queryKey: NEEDS_YOU_TASKS_QUERY_KEY,
      });
    },
  );

  return null;
}

/** The agent working the Task, who is the one asking. People are not named. */
function agentName(task: TaskListItem): string | null {
  if (task.assignee?.type === "sokoBot") {
    return task.assignee.sokoBot.name?.trim() || null;
  }
  if (task.assignee?.type === "coworker") {
    return task.assignee.coworker.name;
  }
  return null;
}

/** The statuses the list asks Core for, which are the ones Home counts. */
type WaitingStatus =
  | typeof TaskStatus.INPUT_REQUIRED
  | typeof TaskStatus.APPROVAL_REQUIRED
  | typeof TaskStatus.AUTHENTICATION_REQUIRED
  | typeof TaskStatus.OUT_OF_CREDITS
  | typeof TaskStatus.GRANT_PENDING;

/** The statuses where the agent asks the reader, so the line names it. */
type AskingStatus =
  | typeof TaskStatus.INPUT_REQUIRED
  | typeof TaskStatus.APPROVAL_REQUIRED
  | typeof TaskStatus.AUTHENTICATION_REQUIRED;

function isAskingStatus(status: TaskStatus): status is AskingStatus {
  return (
    status === TaskStatus.INPUT_REQUIRED ||
    status === TaskStatus.APPROVAL_REQUIRED ||
    status === TaskStatus.AUTHENTICATION_REQUIRED
  );
}

function isWaitingStatus(status: TaskStatus): status is WaitingStatus {
  return (
    isAskingStatus(status) ||
    status === TaskStatus.OUT_OF_CREDITS ||
    status === TaskStatus.GRANT_PENDING
  );
}

/**
 * Answers a Task waiting for input in place. The answer is the same comment
 * the Task page posts; the assigned agent wakes on it and resumes, and the
 * list's own refresh takes the row away once the Task moves on. Sending is
 * the row's, so closing and reopening this composer cannot send twice.
 */
function WaitingTaskAnswer({
  task,
  name,
  isSending,
  onSend,
  onNavigate,
}: {
  task: TaskListItem;
  name: string | null;
  isSending: boolean;
  onSend: (text: string) => void;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Components.NotificationCenter.WaitingTasks");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const question = useQuery({
    // Per reader, workspace and wait: the query client outlives a sign-out,
    // a workspace switch and the agent asking again.
    queryKey: [
      "needs-you-task-question",
      session?.user.id ?? null,
      session?.session.activeOrganizationId ?? null,
      task.id,
      String(task.statusSince),
    ],
    queryFn: async () => {
      const events = (await coreClient.getTaskEvents(task.id)).data;
      if (!isCurrentWait(events, task.statusSince)) {
        // The row is older than the Task: read the list again, and offer
        // no answer to a wait that has ended or been replaced.
        void queryClient.invalidateQueries({
          queryKey: NEEDS_YOU_TASKS_QUERY_KEY,
        });
        return { current: false, text: null };
      }
      return { current: true, text: waitingQuestion(events) };
    },
  });
  const label = name
    ? t("answerPlaceholder", { name })
    : t("answerPlaceholderNoName");
  const send = () => {
    if (text.trim()) onSend(text);
  };
  const onTask = (
    <Link
      href={taskHref(task)}
      onClick={onNavigate}
      className="text-foreground underline underline-offset-2"
    >
      {t("questionOnTask")}
    </Link>
  );

  if (question.data && !question.data.current) {
    return (
      <p
        role="status"
        className="text-muted-foreground px-3 pb-3 text-sm sm:pl-14"
      >
        {t("waitEnded")} {onTask}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 px-3 pb-3 sm:pl-14"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {question.isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("questionLoading")}
        </p>
      ) : question.isError ? (
        <p className="text-muted-foreground text-sm">
          {t("questionError")} {onTask}
        </p>
      ) : question.data?.text ? (
        // Scrolls rather than clips, so a long question stays readable;
        // tabIndex lets a keyboard reader scroll it.
        <p
          tabIndex={0}
          className="bg-muted focus-visible:ring-ring max-h-48 overflow-y-auto rounded-md p-2 text-sm whitespace-pre-line break-words outline-none focus-visible:ring-2"
        >
          {question.data.text}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">{onTask}</p>
      )}
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            send();
          }
        }}
        placeholder={label}
        aria-label={label}
        className="min-h-10"
        autoFocus
      />
      <Button
        type="submit"
        size="sm"
        className="self-end"
        loading={isSending}
        disabled={!text.trim()}
      >
        <Send aria-hidden />
        {t("send")}
      </Button>
    </form>
  );
}

function WaitingTaskRow({
  task,
  name,
  summary,
  action,
  time,
  answerable,
  onNavigate,
}: {
  task: TaskListItem;
  name: string | null;
  summary: string;
  action: string;
  time: string;
  answerable: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Components.NotificationCenter.WaitingTasks");
  const [answering, setAnswering] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [isSending, startSending] = useTransition();
  // One answer per wait: Enter can fire again before the pending state
  // renders, and the composer can be closed and reopened mid-send.
  const sending = useRef(false);
  const link = useRef<HTMLAnchorElement>(null);
  const composer = useRef<HTMLDivElement>(null);

  const send = (text: string) => {
    if (sending.current) return;
    sending.current = true;
    startSending(async () => {
      try {
        await createTaskComment({ taskId: task.id, comment: text });
      } catch {
        sending.current = false;
        toast.error(t("answerError"));
        return;
      }
      // The composer leaves with its focused control; keep the reader in
      // the row, unless they already moved elsewhere.
      const hadFocus =
        composer.current?.contains(document.activeElement) ?? false;
      setAnswered(true);
      if (hadFocus) link.current?.focus();
    });
  };

  return (
    <li>
      <div className="flex items-start">
        <Link
          ref={link}
          href={taskHref(task)}
          onClick={onNavigate}
          className="hover:bg-accent focus-visible:ring-ring flex min-w-0 flex-1 items-start gap-3 p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset"
        >
          <span
            aria-hidden
            className="bg-quinary flex size-8 shrink-0 items-center justify-center rounded-full"
          >
            <StatusMarker
              spec={getTaskStatusMarker(task.status)}
              live={false}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm font-medium text-pretty break-words">
              {task.name}
            </span>
            <span className="text-muted-foreground text-xs">
              {summary}
              {" · "}
              <span className="tabular-nums">{time}</span>
            </span>
          </span>
          {answerable ? null : (
            <span
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "pointer-events-none shrink-0",
              )}
            >
              {action}
            </span>
          )}
        </Link>
        {answerable && answered ? (
          <p
            role="status"
            className="text-muted-foreground shrink-0 p-3 text-xs"
          >
            {t("answerSent")}
          </p>
        ) : null}
        {answerable && !answered ? (
          <Button
            type="button"
            variant={answering ? "secondary" : "outline"}
            size="sm"
            className="m-3 ml-0 shrink-0"
            aria-expanded={answering}
            onClick={() => setAnswering((open) => !open)}
          >
            {action}
          </Button>
        ) : null}
      </div>
      {answering && !answered ? (
        <div ref={composer}>
          <WaitingTaskAnswer
            task={task}
            name={name}
            isSending={isSending}
            onSend={send}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
    </li>
  );
}

interface NotificationWaitingTasksProps {
  /** Closes the surrounding panel, which navigation does not unmount. */
  onNavigate?: () => void;
}

/**
 * The Tasks waiting on the reader, as the Needs you view lists them: the
 * same Tasks and the same number Home's "N tasks need your input" counts.
 * A Task's own ask is a notification row too, and the list leaves those
 * out of Needs you, so each waiting Task is here once.
 *
 * Each row links to the Task and says who asks and for what. A Task waiting
 * for input is answered in place; every other row ends in the move as a
 * button-shaped label, so it reads as one stop rather than two links to the
 * same place.
 */
export function NotificationWaitingTasks({
  onNavigate,
}: NotificationWaitingTasksProps) {
  const t = useTranslations("Components.NotificationCenter.WaitingTasks");
  const tCenter = useTranslations("Components.NotificationCenter");
  const formatTime = useNotificationTimeFormatter();
  const { data, isError, refetch } = useNeedsYouTasks();
  // The panel and the page can both be open, so the heading id is per frame.
  const headingId = useId();

  if (isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <p className="text-muted-foreground text-sm">{t("loadError")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
        >
          {tCenter("retry")}
        </Button>
      </div>
    );
  }

  if (!data || data.count === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3 px-3 pt-3 pb-1">
        <h2 id={headingId} className="text-sm font-medium">
          {t("heading", { count: data.count })}
        </h2>
        {data.count > data.tasks.length ? (
          <Link
            href="/tasks"
            onClick={onNavigate}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-sm outline-none focus-visible:ring-2"
          >
            {t("showAll")}
          </Link>
        ) : null}
      </div>
      <ul className="divide-border divide-y">
        {data.tasks.map((task) => {
          // Core read only these statuses; the guard narrows the type.
          const status = isWaitingStatus(task.status)
            ? task.status
            : TaskStatus.INPUT_REQUIRED;
          const name = agentName(task);
          const summary =
            name && isAskingStatus(status)
              ? t(`ask.${status}`, { name })
              : t(`status.${status}`);
          const action = t(`action.${status}`);

          return (
            <WaitingTaskRow
              // A new ask is a new wait: it starts with its own Answer.
              key={`${task.id}:${String(task.statusSince)}`}
              task={task}
              name={name}
              summary={summary}
              action={action}
              time={formatTime(task.updatedAt)}
              answerable={status === TaskStatus.INPUT_REQUIRED}
              onNavigate={onNavigate}
            />
          );
        })}
      </ul>
    </section>
  );
}
