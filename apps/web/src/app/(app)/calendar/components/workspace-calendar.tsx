"use client";

import FullCalendar, { type EventDropInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import {
  CORE_API_ERROR_KINDS,
  hasActiveTaskSchedule,
  isValidTimezone,
} from "@sokosumi/utils";
import {
  addDays,
  addMonths,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  Ellipsis,
  FolderKanban,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  parseAsString,
  parseAsStringEnum,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { loadTaskScheduleSeriesPrecondition } from "@/app/tasks/actions";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { useCreateTaskModal } from "@/app/tasks/components/create-task-modal";
import type { TaskAssigneeView } from "@/app/tasks/types/task-board";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { OccurrenceTimeDialog } from "@/components/schedules/occurrence-time-dialog";
import { TaskScheduleSection } from "@/components/task-schedule-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import { useLoadWhenVisible } from "@/hooks/use-load-when-visible";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { CalendarRealtimeBridge } from "@/lib/ably/calendar-realtime-bridge";
import {
  clearTaskSchedule,
  mutateTaskOccurrence,
  saveCalendarTaskSchedule,
} from "@/lib/actions/task/action";
import { coreClient } from "@/lib/clients/core.browser.client";
import {
  type Task,
  type TaskListItem,
  TaskStatus,
  type TaskStatus as TaskStatusValue,
  type WorkspaceCalendarItem,
  type WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import {
  getDefaultTimezone,
  getTimezoneOptions,
} from "@/lib/schedules/timezones";
import { utcToDateTimeLocalInTimezone } from "@/lib/schedules/zoned-datetime";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { cn } from "@/lib/utils";
import {
  getTaskScheduleOperationId,
  hasTaskScheduleChanged,
  metadataToSelection,
  schedulableOnceLocalIso,
} from "@/lib/utils/task-schedule";
import {
  type TaskMutationErrorKind,
  taskScheduleSeriesFeedbackKey,
} from "@/lib/utils/task-schedule-feedback";
import { CalendarScheduleList } from "./calendar-schedule-list";
import { SourceMarker } from "./source-marker";

const CALENDAR_VIEWS = ["month", "week", "agenda", "schedules"] as const;
type CalendarView = (typeof CALENDAR_VIEWS)[number];
type OccurrenceCalendarView = Exclude<CalendarView, "schedules">;
const CALENDAR_STATUSES = Object.values(TaskStatus);
const NO_SCHEDULED_TASKS: TaskListItem[] = [];

function isCalendarStatus(value: string | null): value is TaskStatusValue {
  return value !== null && CALENDAR_STATUSES.some((status) => status === value);
}

interface CalendarCoworker {
  id: string;
  image?: string;
  name: string;
  slug?: string;
  kind?: "coworker" | "user" | "sokoBot";
  avatarSeed?: string | null;
}

interface CalendarPeople {
  assignee: TaskAssigneeView | null;
  owner: CalendarCoworker | null;
}

/** Joins an item's assignee and owner ids against the workspace roster. */
function findCalendarPeople(
  item: WorkspaceCalendarItem,
  coworkers: CalendarCoworker[],
): CalendarPeople {
  const assigneeCoworker = item.taskAssigneeUserId
    ? coworkers.find(
        ({ id, kind }) => kind === "user" && id === item.taskAssigneeUserId,
      )
    : item.taskAssigneeId
      ? coworkers.find(
          ({ id, kind }) => kind !== "user" && id === item.taskAssigneeId,
        )
      : undefined;
  return {
    assignee: assigneeCoworker
      ? { ...assigneeCoworker, kind: assigneeCoworker.kind ?? "coworker" }
      : null,
    owner:
      coworkers.find(
        ({ id, kind }) => kind === "user" && id === item.taskOwnerId,
      ) ?? null,
  };
}

interface WorkspaceCalendarProps {
  activeOrganizationId?: string | null;
  currentUserId?: string | null;
  initialDate: string;
  items: WorkspaceCalendarItem[];
  latestDate?: string;
  sources?: WorkspaceCalendarSource[];
  pagination?: {
    limit: number;
    nextCursor: string | null;
  } | null;
  range?: {
    from: Date;
    to: Date;
  };
  coworkers?: CalendarCoworker[];
  lockedProjectId?: string;
  scheduledTasks?: TaskListItem[];
  scheduledTasksPagination?: {
    limit: number;
    nextCursor: string | null;
  } | null;
  workspaceId?: string | null;
}

const calendarParsers = {
  assigneeId: parseAsString,
  assigneeUserId: parseAsString,
  date: parseAsString,
  projectId: parseAsString,
  sourceId: parseAsString,
  scope: parseAsStringLiteral(["owned", "workspace"]).withDefault("workspace"),
  status: parseAsStringEnum<TaskStatusValue>(CALENDAR_STATUSES),
  timezone: parseAsString,
  view: parseAsStringLiteral(CALENDAR_VIEWS),
};

function parseCalendarDate(value: string, fallback: string): Date {
  try {
    return new Date(`${Temporal.PlainDate.from(value).toString()}T12:00:00`);
  } catch {
    return new Date(`${Temporal.PlainDate.from(fallback).toString()}T12:00:00`);
  }
}

function getCalendarDayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function getProjectIdFromSource(
  source: WorkspaceCalendarSource,
): string | null {
  if (source.sourceType !== "PROJECT") {
    return null;
  }

  const projectId = source.sourceId.replace(/^project:/, "");
  return projectId ? projectId : null;
}

export function getCalendarItemDateKey(date: Date, timeZone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function getRangeLabel(
  formatDate: ReturnType<typeof useFormatter>["dateTime"],
  date: Date,
  view: OccurrenceCalendarView,
) {
  if (view === "week") {
    return `${formatDate(startOfWeek(date), { month: "short", day: "numeric" })} - ${formatDate(endOfWeek(date), { month: "short", day: "numeric", year: "numeric" })}`;
  }

  return formatDate(date, { month: "long", year: "numeric" });
}

/**
 * Only an unreleased occurrence the caller owns can be moved. A released row
 * is history, and a row the caller cannot edit must not be draggable either.
 */
function isMovableCalendarItem(item: WorkspaceCalendarItem): boolean {
  return item.canMutateOccurrence && item.state === "PLANNED";
}

function isRestorableCalendarItem(item: WorkspaceCalendarItem): boolean {
  return (
    item.canMutateOccurrence &&
    item.state === "SKIPPED" &&
    item.originalScheduledAt !== null
  );
}

function CalendarEvent({
  item,
  people,
  onEditSchedule,
  onMoveOccurrence,
  onRestoreOccurrence,
  onSkipOccurrence,
  onOpenTask,
  source,
  timeText,
}: {
  item: WorkspaceCalendarItem;
  people: CalendarPeople;
  onEditSchedule: (taskId: string) => void;
  onMoveOccurrence: (item: WorkspaceCalendarItem) => void;
  onRestoreOccurrence: (item: WorkspaceCalendarItem) => void;
  onSkipOccurrence: (item: WorkspaceCalendarItem) => void;
  onOpenTask: (taskId: string) => void;
  source: WorkspaceCalendarSource | undefined;
  timeText: string | undefined;
}) {
  const t = useTranslations("App.Calendar");
  const peopleId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  // Where a mouse drag began on a card FullCalendar will not move.
  const dragAttemptOrigin = useRef<{ x: number; y: number } | null>(null);
  const sourceName = source?.displayName ?? t(`source.${item.sourceType}`);
  const sourceMarker = (
    <SourceMarker decorative source={source} sourceName={sourceName} />
  );
  const accuracyMarker =
    item.sourceAccuracy !== "EXACT" ? (
      <span
        aria-label={t(`accuracy.${item.sourceAccuracy.toLowerCase()}`)}
        className="text-muted-foreground shrink-0"
        role="img"
      >
        ~
      </span>
    ) : null;
  const peopleNames = [people.assignee?.name, people.owner?.name]
    .filter((name): name is string => Boolean(name?.trim()))
    .join(", ");
  const peopleStack = peopleNames ? (
    <>
      <span
        aria-hidden
        className="flex shrink-0 items-center -space-x-1"
        data-testid="calendar-event-people"
        title={peopleNames}
      >
        {people.assignee ? <AssigneeAvatar assignee={people.assignee} /> : null}
        {people.owner ? (
          <UserProfileAvatar
            className="z-10"
            image={people.owner.image}
            name={people.owner.name}
          />
        ) : null}
      </span>
      <span className="sr-only" id={peopleId}>
        {peopleNames}
      </span>
    </>
  ) : null;

  const menuButton = (
    <DropdownMenuTrigger asChild>
      <button
        aria-describedby={peopleNames ? peopleId : undefined}
        aria-label={t(
          item.state === "SKIPPED"
            ? "event.accessibleNameSkipped"
            : "event.accessibleName",
          {
            source: sourceName,
            task: item.taskName,
          },
        )}
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring ml-auto flex size-5 shrink-0 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2"
        // Radix already toggled on pointerdown; the click must not reach the
        // card's own open handler.
        onClick={(event) => event.stopPropagation()}
        type="button"
      >
        <Ellipsis aria-hidden className="size-4" />
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      {/*
        The card is deliberately not the menu trigger: Radix opens on
        pointerdown and cancels the mousedown FullCalendar needs to start a
        drag. A click after a drop never lands here (the mouseup hits the
        drag mirror), so a click on the card is always a plain tap.
      */}
      <div
        className={cn(
          "bg-background text-foreground hover:bg-muted border border-border flex w-full min-w-0 cursor-pointer select-none flex-col items-start gap-0.5 overflow-hidden rounded px-1.5 py-1 text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
          item.state === "SKIPPED" && "text-muted-foreground line-through",
        )}
        data-testid="calendar-event"
        onClick={() => setMenuOpen(true)}
        // FullCalendar silently ignores a drag on someone else's task; say
        // who can move it once the mouse has clearly started dragging.
        onPointerDown={(event) => {
          dragAttemptOrigin.current =
            event.pointerType !== "touch" && !item.canEditSchedule
              ? { x: event.clientX, y: event.clientY }
              : null;
        }}
        onPointerLeave={() => {
          dragAttemptOrigin.current = null;
        }}
        onPointerMove={(event) => {
          const origin = dragAttemptOrigin.current;
          if (
            !origin ||
            Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 8
          ) {
            return;
          }
          dragAttemptOrigin.current = null;
          toast.info(t("event.moveNotAllowed"));
        }}
        onPointerUp={() => {
          dragAttemptOrigin.current = null;
        }}
      >
        <span className="flex w-full min-w-0 items-center gap-1">
          {sourceMarker}
          {timeText ? (
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {timeText}
            </span>
          ) : null}
          {accuracyMarker}
          <span className="text-muted-foreground min-w-0 truncate">
            {sourceName}
          </span>
        </span>
        <span className="line-clamp-2 w-full min-w-0">{item.taskName}</span>
        <span className="flex w-full min-w-0 items-center gap-1">
          {peopleStack}
          {menuButton}
        </span>
      </div>
      <DropdownMenuContent align="end">
        {item.canEditSchedule ? (
          <DropdownMenuItem onSelect={() => onEditSchedule(item.taskId)}>
            {t("event.editSchedule")}
          </DropdownMenuItem>
        ) : null}
        {isMovableCalendarItem(item) ? (
          <>
            <DropdownMenuItem onSelect={() => onMoveOccurrence(item)}>
              {t("event.moveOccurrence")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSkipOccurrence(item)}>
              {t("event.skipOccurrence")}
            </DropdownMenuItem>
          </>
        ) : null}
        {isRestorableCalendarItem(item) ? (
          <DropdownMenuItem onSelect={() => onRestoreOccurrence(item)}>
            {t("event.restoreOccurrence")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => onOpenTask(item.taskId)}>
          {t("event.openTask")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CalendarView({
  canCreate,
  coworkers,
  date,
  items,
  onDateClick,
  onEventEdit,
  onMoveOccurrence,
  onRestoreOccurrence,
  onSkipOccurrence,
  onOpenTask,
  sources,
  timeZone,
  view,
}: {
  canCreate: boolean;
  coworkers: CalendarCoworker[];
  date: Date;
  items: WorkspaceCalendarItem[];
  onDateClick: (date: Date) => void;
  onEventEdit: (taskId: string) => void;
  onMoveOccurrence: (item: WorkspaceCalendarItem) => void;
  onRestoreOccurrence: (item: WorkspaceCalendarItem) => void;
  onSkipOccurrence: (item: WorkspaceCalendarItem) => void;
  onOpenTask: (taskId: string) => void;
  sources: WorkspaceCalendarSource[];
  timeZone: string;
  view: OccurrenceCalendarView;
}) {
  const router = useRouter();
  const formatDate = useFormatter().dateTime;
  const tSeries = useTranslations("App.Tasks.Schedule.series");
  const tMove = useTranslations("App.Tasks.Schedule.occurrenceMove");
  // Optimistic overlay for an in-flight drop: the event renders at the time it
  // was dropped at until Core confirms it or the rollback removes it.
  const [pendingMoves, setPendingMoves] = useState<Record<string, Date>>({});
  const pluginView = {
    month: "dayGridMonth",
    week: "dayGridWeek",
  }[view === "agenda" ? "week" : view];

  function clearPendingMove(occurrenceId: string) {
    setPendingMoves((moves) => {
      const { [occurrenceId]: _dropped, ...rest } = moves;
      return rest;
    });
  }

  async function handleEventDrop(info: EventDropInfo) {
    const item = items.find(({ id }) => id === info.event.id);
    const scheduledAt = info.event.start;
    if (!item || !scheduledAt || !isMovableCalendarItem(item)) {
      info.revert();
      return;
    }

    const occurrenceId = item.id;
    setPendingMoves((moves) => ({ ...moves, [occurrenceId]: scheduledAt }));

    try {
      // Every drop is its own attempt; a retry is a new drag, not a replay.
      const result = await mutateTaskOccurrence({
        taskId: item.taskId,
        occurrenceId,
        operationId: crypto.randomUUID(),
        expectedScheduleRevision: item.scheduleRevision,
        action: "reschedule",
        scheduledAt: scheduledAt.toISOString(),
      });

      if (!result.ok) {
        clearPendingMove(occurrenceId);
        info.revert();
        // The series moved on under us, so the rendered events are stale too.
        if (
          result.error.kind ===
            CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT ||
          result.error.kind === CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE
        ) {
          router.refresh();
        }
        const feedbackKey = taskScheduleSeriesFeedbackKey(result.error.kind);
        toast.error(feedbackKey ? tSeries(feedbackKey) : tMove("error"), {
          duration: Infinity,
        });
        return;
      }

      router.refresh();
    } catch {
      clearPendingMove(occurrenceId);
      info.revert();
      toast.error(tMove("error"), { duration: Infinity });
    }
  }

  const t = useTranslations("App.Calendar");
  const dateKey = getCalendarDayKey(date);

  if (view === "agenda") {
    const days = Map.groupBy(items, (item) =>
      getCalendarItemDateKey(item.scheduledAt, timeZone),
    );
    return (
      <div className="flex flex-col gap-4" data-testid="calendar-agenda">
        <h2 className="text-lg font-semibold">{t("agenda.upcoming")}</h2>
        {items.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            {t("empty.title")}
          </p>
        ) : null}
        {Array.from(days, ([day, dayItems]) => (
          <section className="overflow-hidden rounded-xl border" key={day}>
            <h3 className="bg-muted flex items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold">
              <span>
                {formatDate(dayItems[0].scheduledAt, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  timeZone,
                })}
              </span>
              <span>
                {formatDate(dayItems[0].scheduledAt, {
                  weekday: "long",
                  timeZone,
                })}
              </span>
            </h3>
            <ul className="flex flex-col gap-2 p-3">
              {dayItems.map((item) => (
                <li key={item.id}>
                  <CalendarEvent
                    item={item}
                    people={findCalendarPeople(item, coworkers)}
                    onEditSchedule={onEventEdit}
                    onMoveOccurrence={onMoveOccurrence}
                    onRestoreOccurrence={onRestoreOccurrence}
                    onSkipOccurrence={onSkipOccurrence}
                    onOpenTask={onOpenTask}
                    source={sources.find(
                      ({ sourceId }) => sourceId === item.sourceId,
                    )}
                    timeText={formatDate(item.scheduledAt, "time", {
                      timeZone,
                    })}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <>
      <div
        className="workspace-calendar-theme -mx-4 overflow-x-auto rounded-none border-0 border-border bg-background md:mx-0 md:rounded-xl md:border"
        data-can-create={canCreate ? "true" : undefined}
        data-view={view}
        data-testid={`calendar-${view}`}
      >
        <FullCalendar
          borderless
          dayCellClass={
            canCreate
              ? "hover:bg-primary-quaternary motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out"
              : undefined
          }
          key={`${dateKey}-${timeZone}-${view}`}
          plugins={[classicTheme, dayGridPlugin, interactionPlugin]}
          initialDate={dateKey}
          initialView={pluginView}
          events={items.map((item) => ({
            id: item.id,
            title: item.taskName,
            start: (pendingMoves[item.id] ?? item.scheduledAt).toISOString(),
            // Per-event: a released or unowned row is visible but not draggable.
            startEditable: isMovableCalendarItem(item),
            durationEditable: false,
          }))}
          timeZone={timeZone}
          headerToolbar={false}
          height="auto"
          // Timed events default to "list-item" (dot + time + title); the card
          // already carries the time, so the dot was the only leftover. Block
          // mode paints the theme's event blue behind the card; the card is
          // the only fill wanted.
          eventDisplay="block"
          eventColor="transparent"
          editable={false}
          eventDurationEditable={false}
          eventAllow={(_span, movingEvent) => {
            const item = movingEvent
              ? items.find(({ id }) => id === movingEvent.id)
              : undefined;
            return Boolean(item && isMovableCalendarItem(item));
          }}
          eventDrop={(info) => void handleEventDrop(info)}
          eventContent={(eventInfo) => {
            const item = items.find(({ id }) => id === eventInfo.event.id);
            if (!item) {
              return eventInfo.event.title;
            }
            const start = eventInfo.event.start;
            return (
              <CalendarEvent
                item={item}
                people={findCalendarPeople(item, coworkers)}
                onEditSchedule={onEventEdit}
                onMoveOccurrence={onMoveOccurrence}
                onRestoreOccurrence={onRestoreOccurrence}
                onSkipOccurrence={onSkipOccurrence}
                onOpenTask={onOpenTask}
                source={sources.find(
                  ({ sourceId }) => sourceId === item.sourceId,
                )}
                // FullCalendar's own timeText is en-US shorthand ("8a") in every
                // locale; format the instant in the calendar zone ourselves.
                timeText={
                  start ? formatDate(start, "time", { timeZone }) : undefined
                }
              />
            );
          }}
          dateClick={(dateInfo) => onDateClick(dateInfo.date)}
        />
      </div>
    </>
  );
}

interface CalendarEditDialogProps {
  initialSelection: TaskScheduleSelection;
  onClose: () => void;
  task: Task;
  /** Revision observed when the editor opened; the mutation precondition. */
  scheduleRevision: number;
  /**
   * Durable future exceptions this edit would cancel, read with the revision,
   * or `null` when the ledger could not be read.
   */
  futureExceptionCount: number | null;
}

function CalendarEditDialog({
  initialSelection,
  onClose,
  task,
  scheduleRevision,
  futureExceptionCount: observedFutureExceptionCount,
}: CalendarEditDialogProps) {
  const t = useTranslations("App.Calendar");
  const tSeries = useTranslations("App.Tasks.Schedule.series");
  const router = useRouter();
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [isClearingSchedule, setIsClearingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDiscard, setPendingDiscard] =
    useState<TaskScheduleSelection | null>(null);
  // A revision conflict proves the observed count describes a series that has
  // since moved on, so from then on this editor treats it as unknown.
  const [isCountStale, setIsCountStale] = useState(false);
  const futureExceptionCount = isCountStale
    ? null
    : observedFutureExceptionCount;
  const clearRequestPending = useRef(false);
  // One UUID per distinct submitted schedule: a retry of the same rule replays
  // on Core, while editing the rule again is a new operation.
  const saveOperation = useRef<{ key: string; operationId: string } | null>(
    null,
  );
  // One UUID for the removal the user is confirming, kept across retries so a
  // second attempt replays the first rather than racing its own revision bump.
  const clearOperation = useRef<string | null>(null);

  function resolveMutationError(
    kind: TaskMutationErrorKind,
    fallback: string,
  ): string {
    const feedbackKey = taskScheduleSeriesFeedbackKey(kind);
    return feedbackKey ? tSeries(feedbackKey) : fallback;
  }

  async function submitSave(schedule: TaskScheduleSelection) {
    setError(null);
    try {
      const result = await saveCalendarTaskSchedule({
        taskId: task.id,
        operationId: getTaskScheduleOperationId(schedule, saveOperation),
        expectedScheduleRevision: scheduleRevision,
        schedule,
      });
      if (!result.ok) {
        if (
          result.error.kind === CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT
        ) {
          // The series moved on, so the count read with the old revision no
          // longer describes it. Nothing here may reuse it as "zero".
          setIsCountStale(true);
        }
        setError(resolveMutationError(result.error.kind, t("edit.saveError")));
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t("edit.saveError"));
    }
  }

  async function handleSave(schedule: TaskScheduleSelection) {
    // Core mints a new rule epoch on every full-series edit, so submitting an
    // untouched rule would churn the audit trail and reset consumed runs.
    if (!hasTaskScheduleChanged(initialSelection, schedule, true)) {
      onClose();
      return;
    }

    // An unreadable count cannot say what a new rule would cancel, so the edit
    // is refused instead of discarding silently. Removal states its own
    // consequence in its confirmation and still proceeds.
    if (futureExceptionCount === null) {
      setError(tSeries("unknownCount"));
      return;
    }

    if (futureExceptionCount > 0) {
      setError(null);
      setPendingDiscard(schedule);
      return;
    }

    await submitSave(schedule);
  }

  async function handleConfirmDiscard() {
    if (!pendingDiscard) return;
    const schedule = pendingDiscard;
    setPendingDiscard(null);
    await submitSave(schedule);
  }

  async function handleClearSchedule(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (clearRequestPending.current) {
      return;
    }

    clearRequestPending.current = true;
    setIsClearingSchedule(true);
    setClearError(null);
    setError(null);
    try {
      clearOperation.current ??= crypto.randomUUID();
      const result = await clearTaskSchedule({
        taskId: task.id,
        operationId: clearOperation.current,
        expectedScheduleRevision: scheduleRevision,
      });
      if (!result.ok) {
        setClearError(
          resolveMutationError(result.error.kind, t("edit.clearError")),
        );
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setClearError(t("edit.clearError"));
    } finally {
      clearRequestPending.current = false;
      setIsClearingSchedule(false);
    }
  }

  function handleClearConfirmationOpenChange(open: boolean) {
    if (!open && clearRequestPending.current) {
      return;
    }

    setClearConfirmationOpen(open);
    if (!open) {
      setClearError(null);
      clearOperation.current = null;
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("edit.title")}</DialogTitle>
          <DialogDescription>
            {t("edit.description", { name: task.name })}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <TaskScheduleSection
          key={`${task.id}-${initialSelection.mode}-${initialSelection.timezone}-${initialSelection.oneTimeLocalIso ?? ""}-${initialSelection.cron ?? ""}-${initialSelection.customCronExpr ?? ""}`}
          initialSelection={initialSelection}
          onCancel={onClose}
          onClearSchedule={() => {
            setClearError(null);
            clearOperation.current = crypto.randomUUID();
            setClearConfirmationOpen(true);
          }}
          onSave={handleSave}
          canClearSchedule={initialSelection.mode !== "none"}
          hideHeader
        />
        {pendingDiscard ? (
          <AlertDialog
            open
            onOpenChange={(open) => !open && setPendingDiscard(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {tSeries("discardTitle", {
                    count: futureExceptionCount ?? 0,
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {tSeries("discardDescription", {
                    count: futureExceptionCount ?? 0,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {tSeries("discardCancel")}
                </AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleConfirmDiscard()}>
                  {tSeries("discardConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        <AlertDialog
          open={clearConfirmationOpen}
          onOpenChange={handleClearConfirmationOpenChange}
        >
          <AlertDialogContent
            onEscapeKeyDown={(event) => {
              if (clearRequestPending.current) {
                event.preventDefault();
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{t("edit.clearTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("edit.clearDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {clearError ? (
              <p className="text-destructive text-sm" role="alert">
                {clearError}
              </p>
            ) : null}
            <p className="sr-only" role="status">
              {isClearingSchedule ? t("edit.clearPending") : null}
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isClearingSchedule}>
                {t("edit.clearCancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isClearingSchedule}
                onClick={handleClearSchedule}
              >
                {t("edit.clearConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

interface CalendarEditState {
  initialSelection: TaskScheduleSelection;
  requestId: number;
  task: Task;
  scheduleRevision: number;
  futureExceptionCount: number | null;
}

interface OccurrenceTimeState {
  action: "reschedule" | "restore";
  item: WorkspaceCalendarItem;
}

export function WorkspaceCalendar({
  activeOrganizationId = null,
  currentUserId = null,
  initialDate,
  items,
  latestDate,
  sources = [],
  pagination = null,
  range,
  coworkers = [],
  lockedProjectId,
  scheduledTasks = NO_SCHEDULED_TASKS,
  scheduledTasksPagination = null,
  workspaceId = null,
}: WorkspaceCalendarProps) {
  const t = useTranslations("App.Calendar");
  const tFilters = useTranslations("App.Tasks.Filters");
  const tSeries = useTranslations("App.Tasks.Schedule.series");
  const formatDate = useFormatter().dateTime;
  const router = useRouter();
  const { handleOpenWithDefaults } = useCreateTaskModal();
  const [state, setState] = useQueryStates(calendarParsers);
  const [loadedItems, setLoadedItems] = useState(items);
  const [nextCursor, setNextCursor] = useState(pagination?.nextCursor ?? null);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [isLoadingOccurrences, setIsLoadingOccurrences] = useState(false);
  const agendaBoundaryRef = useRef<HTMLDivElement>(null);
  const [loadedSchedules, setLoadedSchedules] = useState(scheduledTasks);
  const [schedulesNextCursor, setSchedulesNextCursor] = useState(
    scheduledTasksPagination?.nextCursor ?? null,
  );
  const [schedulesLoadMoreError, setSchedulesLoadMoreError] = useState(false);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  // The page already requested, keyed on the server items too so a refreshed
  // server page that reuses a cursor string drains again.
  const requestedPageRef = useRef<{
    cursor: string;
    items: WorkspaceCalendarItem[];
  } | null>(null);
  const [editState, setEditState] = useState<CalendarEditState | null>(null);
  const [timeState, setTimeState] = useState<OccurrenceTimeState | null>(null);
  const [eventLoadError, setEventLoadError] = useState(false);
  const [calendarRenderEpoch, setCalendarRenderEpoch] = useState(0);
  const eventRequestId = useRef(0);
  const calendarAccessGeneration = useRef(0);
  const hasActivatedRef = useRef(false);

  // Reset on a new server page during render, not in an effect, so a stale
  // (possibly cleared/rescheduled) item never commits for a frame before
  // correcting (react.dev: adjust state during render on prop change).
  const [prevItems, setPrevItems] = useState(items);
  const [prevServerNextCursor, setPrevServerNextCursor] = useState(
    pagination?.nextCursor ?? null,
  );
  if (
    items !== prevItems ||
    (pagination?.nextCursor ?? null) !== prevServerNextCursor
  ) {
    // A request from the previous snapshot must not append stale occurrences.
    calendarAccessGeneration.current += 1;
    eventRequestId.current += 1;
    setPrevItems(items);
    setPrevServerNextCursor(pagination?.nextCursor ?? null);
    setIsLoadingOccurrences(false);
    setLoadedItems(items);
    setNextCursor(pagination?.nextCursor ?? null);
    setLoadMoreError(false);
  }

  const [prevScheduledTasks, setPrevScheduledTasks] = useState(scheduledTasks);
  const [prevScheduledNextCursor, setPrevScheduledNextCursor] = useState(
    scheduledTasksPagination?.nextCursor ?? null,
  );
  if (
    scheduledTasks !== prevScheduledTasks ||
    (scheduledTasksPagination?.nextCursor ?? null) !== prevScheduledNextCursor
  ) {
    setPrevScheduledTasks(scheduledTasks);
    setPrevScheduledNextCursor(scheduledTasksPagination?.nextCursor ?? null);
    setLoadedSchedules(scheduledTasks);
    setSchedulesNextCursor(scheduledTasksPagination?.nextCursor ?? null);
    setSchedulesLoadMoreError(false);
  }

  useMountEffect(() => {
    // Defer past React StrictMode's synchronous setup -> cleanup -> setup
    // dev-mode cycle: only the microtask from the setup that survives (isn't
    // cancelled by an immediate synthetic cleanup) marks activation or
    // recreates the Calendar views once for a real reactivation.
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      if (hasActivatedRef.current) {
        setCalendarRenderEpoch((epoch) => epoch + 1);
        return;
      }
      hasActivatedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  });

  const date = parseCalendarDate(state.date ?? initialDate, initialDate);
  const timeZone = isValidTimezone(state.timezone)
    ? state.timezone
    : getDefaultTimezone();
  const isMobile = useIsMobile();
  // Phones open on the agenda list; a seven-column grid is a desktop default.
  const view = state.view ?? (isMobile ? "agenda" : "week");
  const selectedProjectId = lockedProjectId ? null : state.projectId;
  const selectedSourceId = lockedProjectId
    ? null
    : selectedProjectId
      ? `project:${selectedProjectId}`
      : state.sourceId;
  const selectedSchedulableSource = sources.find(
    (source) => source.sourceId === selectedSourceId && source.isSchedulable,
  );
  // Tri-state for task creation: a Project id, `null` for an explicit Workspace
  // source, `undefined` when no source is filtered and the user must choose.
  const selectedCreateProjectId =
    lockedProjectId ??
    (selectedSchedulableSource?.sourceType === "PROJECT"
      ? (getProjectIdFromSource(selectedSchedulableSource) ?? undefined)
      : selectedSchedulableSource?.sourceType === "WORKSPACE"
        ? null
        : undefined);
  const canCreate = sources.some(
    (source) =>
      source.isSchedulable &&
      (source.sourceType === "WORKSPACE" ||
        getProjectIdFromSource(source) !== null) &&
      (!lockedProjectId || source.sourceId === `project:${lockedProjectId}`),
  );

  useMountEffect(() => {
    if (!isValidTimezone(state.timezone)) {
      void setState({ timezone: timeZone }, { shallow: false });
    }
  });

  useEffect(() => {
    if (isMobile && state.view === null) {
      void setState({ view: "agenda" }, { shallow: false });
    }
  }, [isMobile, state.view, setState]);

  const latestCalendarDate = latestDate
    ? parseCalendarDate(latestDate, initialDate)
    : null;
  const visibleItems = loadedItems
    .filter(
      (item) =>
        (view !== "agenda" ||
          (item.state === "PLANNED" &&
            getCalendarItemDateKey(item.scheduledAt, timeZone) >=
              Temporal.Now.plainDateISO(timeZone).toString())) &&
        (state.assigneeId === null ||
          item.taskAssigneeId === state.assigneeId) &&
        (state.assigneeUserId === null ||
          item.taskAssigneeUserId === state.assigneeUserId) &&
        (state.status === null || item.taskStatus === state.status) &&
        (selectedSourceId === null || item.sourceId === selectedSourceId),
    )
    .sort(
      (left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime(),
    );

  function getNavigatedDate(direction: -1 | 1): Date {
    return view === "week"
      ? addDays(date, direction * 7)
      : addMonths(date, direction);
  }

  const canNavigateForward =
    latestCalendarDate === null ||
    startOfMonth(getNavigatedDate(1)).getTime() <=
      startOfMonth(latestCalendarDate).getTime();

  function handleNavigate(direction: -1 | 1) {
    if (direction === 1 && !canNavigateForward) {
      return;
    }

    const nextDate = getNavigatedDate(direction);
    void setState({ date: format(nextDate, "yyyy-MM-dd") }, { shallow: false });
  }

  function handleViewChange(view: CalendarView) {
    void setState({ view }, { shallow: false });
  }

  function handleSourceChange(sourceId: string | null) {
    const source = sources.find((source) => source.sourceId === sourceId);
    const projectId = source ? getProjectIdFromSource(source) : null;
    if (projectId) {
      void setState({ projectId, sourceId: null }, { shallow: false });
      return;
    }

    void setState({ projectId: null, sourceId }, { shallow: false });
  }

  function openCreateDialog(oneTimeLocalIso: string) {
    eventRequestId.current += 1;
    setEventLoadError(false);
    handleOpenWithDefaults({
      projectId: selectedCreateProjectId,
      schedule: {
        mode: "once",
        oneTimeLocalIso: schedulableOnceLocalIso(oneTimeLocalIso, timeZone),
        timezone: timeZone,
      },
    });
  }

  function handleDateClick(clickedAt: Date) {
    if (!canCreate) {
      return;
    }
    openCreateDialog(utcToDateTimeLocalInTimezone(clickedAt, timeZone));
  }

  function handleAgendaCreate() {
    openCreateDialog(`${getCalendarDayKey(date)}T12:00`);
  }

  /**
   * The ledger read carries both the mutation precondition and the exact number
   * of future exceptions an edit would discard. It is Calendar-beta gated while
   * removal deliberately is not, so a failure keeps the Task's own revision —
   * removal still works — while the count stays unknown rather than zero.
   */
  async function readSeriesPrecondition(taskId: string) {
    try {
      return await loadTaskScheduleSeriesPrecondition(taskId);
    } catch (error) {
      console.error("Failed to read the schedule series state", error);
      return null;
    }
  }

  async function handleEventEdit(taskId: string) {
    const requestId = eventRequestId.current + 1;
    eventRequestId.current = requestId;
    setEventLoadError(false);
    try {
      const [result, occurrencePage] = await Promise.all([
        coreClient.getTaskById(taskId),
        readSeriesPrecondition(taskId),
      ]);
      if (requestId !== eventRequestId.current) {
        return;
      }
      setEditState({
        initialSelection: metadataToSelection(
          result.data.metadata,
          getDefaultTimezone(),
        ),
        requestId,
        task: result.data,
        scheduleRevision:
          occurrencePage?.scheduleRevision ?? result.data.scheduleRevision ?? 0,
        futureExceptionCount:
          occurrencePage?.futureExceptionCount ??
          // A Task with no live rule has nothing to discard, so an unread
          // ledger only leaves the count unknown for a series that has one.
          (hasActiveTaskSchedule(result.data.metadata, result.data.nextRunAt)
            ? null
            : 0),
      });
    } catch {
      if (requestId === eventRequestId.current) {
        setEventLoadError(true);
      }
    }
  }

  function handleOpenTask(taskId: string) {
    router.push(`/tasks/${taskId}`);
  }

  function handleMoveOccurrence(item: WorkspaceCalendarItem) {
    setTimeState({ action: "reschedule", item });
  }

  function handleRestoreOccurrence(item: WorkspaceCalendarItem) {
    setTimeState({ action: "restore", item });
  }

  async function handleSkipOccurrence(item: WorkspaceCalendarItem) {
    try {
      const result = await mutateTaskOccurrence({
        taskId: item.taskId,
        occurrenceId: item.id,
        operationId: crypto.randomUUID(),
        expectedScheduleRevision: item.scheduleRevision,
        action: "skip",
      });
      if (!result.ok) {
        const feedbackKey = taskScheduleSeriesFeedbackKey(result.error.kind);
        toast.error(
          feedbackKey ? tSeries(feedbackKey) : t("event.mutationError"),
          { duration: Infinity },
        );
        if (
          result.error.kind ===
            CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT ||
          result.error.kind === CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE
        ) {
          router.refresh();
        }
        return;
      }
      router.refresh();
    } catch {
      toast.error(t("event.mutationError"), { duration: Infinity });
    }
  }

  async function loadNextPage() {
    if (!nextCursor || !range || isLoadingOccurrences) {
      return;
    }

    const accessGeneration = calendarAccessGeneration.current;
    setIsLoadingOccurrences(true);
    setLoadMoreError(false);
    try {
      const query = {
        from: range.from,
        to: range.to,
        cursor: nextCursor,
        limit: view === "agenda" ? 10 : (pagination?.limit ?? 100),
        scope: state.scope,
        assigneeId: state.assigneeId ?? undefined,
        assigneeUserId: state.assigneeUserId ?? undefined,
        status: state.status ?? undefined,
        ...(selectedProjectId
          ? { projectId: selectedProjectId }
          : selectedSourceId
            ? { sourceId: selectedSourceId }
            : {}),
      };
      const result = lockedProjectId
        ? await coreClient.getProjectsByIdCalendar(lockedProjectId, query)
        : await coreClient.getWorkspaceCalendar(query);
      if (accessGeneration !== calendarAccessGeneration.current) {
        return;
      }
      setLoadedItems((currentItems) => [
        ...currentItems,
        ...result.data.filter(
          (item) => !currentItems.some(({ id }) => id === item.id),
        ),
      ]);
      setNextCursor(result.meta?.pagination?.nextCursor ?? null);
    } catch {
      if (accessGeneration === calendarAccessGeneration.current) {
        setLoadMoreError(true);
      }
    } finally {
      if (accessGeneration === calendarAccessGeneration.current) {
        setIsLoadingOccurrences(false);
      }
    }
  }

  async function loadNextSchedulesPage() {
    if (!schedulesNextCursor || isLoadingSchedules) {
      return;
    }

    const accessGeneration = calendarAccessGeneration.current;
    setIsLoadingSchedules(true);
    try {
      const result = await coreClient.getTasks({
        hasSchedule: "true",
        sort: "nextRunAt",
        scope: state.scope,
        status: state.status ? [state.status] : undefined,
        assigneeId: state.assigneeId ?? undefined,
        assigneeUserId: state.assigneeUserId ?? undefined,
        projectId: lockedProjectId ?? state.projectId ?? undefined,
        cursor: schedulesNextCursor,
        limit: scheduledTasksPagination?.limit ?? 100,
      });
      if (accessGeneration !== calendarAccessGeneration.current) {
        return;
      }
      setLoadedSchedules((currentTasks) => [
        ...currentTasks,
        ...result.data.filter(
          (task) => !currentTasks.some(({ id }) => id === task.id),
        ),
      ]);
      setSchedulesNextCursor(result.meta?.pagination?.nextCursor ?? null);
      setSchedulesLoadMoreError(false);
    } catch {
      if (accessGeneration === calendarAccessGeneration.current) {
        setSchedulesLoadMoreError(true);
      }
    } finally {
      if (accessGeneration === calendarAccessGeneration.current) {
        setIsLoadingSchedules(false);
      }
    }
  }

  function handleCalendarAccessRevoked() {
    calendarAccessGeneration.current += 1;
    eventRequestId.current += 1;
    setLoadedItems([]);
    setNextCursor(null);
    setLoadMoreError(false);
    setLoadedSchedules([]);
    setSchedulesNextCursor(null);
    setSchedulesLoadMoreError(false);
    setEditState(null);
    setTimeState(null);
  }

  function handleCalendarInvalidated() {
    calendarAccessGeneration.current += 1;
    eventRequestId.current += 1;
  }

  function handleCalendarResync() {
    handleCalendarInvalidated();
    setLoadMoreError(false);
    setSchedulesLoadMoreError(false);
    setEditState(null);
    setTimeState(null);
  }

  // Month/week grids must show every event: a day holding three of its five
  // events looks complete. Drain the remaining pages as soon as one appears.
  useEffect(() => {
    const requested = requestedPageRef.current;
    if (
      view === "agenda" ||
      !nextCursor ||
      loadMoreError ||
      (requested?.cursor === nextCursor && requested.items === items)
    ) {
      return;
    }
    requestedPageRef.current = { cursor: nextCursor, items };
    void loadNextPage();
  }, [view, items, nextCursor, loadMoreError, loadNextPage]);

  useLoadWhenVisible(agendaBoundaryRef, {
    armed:
      view === "agenda" &&
      nextCursor !== null &&
      !isLoadingOccurrences &&
      !loadMoreError,
    boundaryKey: `${nextCursor}-${visibleItems.length}`,
    onVisible: () => void loadNextPage(),
  });

  const filterSections: FilterDropdownMenuSection[] = [
    ...(activeOrganizationId
      ? [
          {
            id: "scope",
            label: tFilters("scopeLabel"),
            icon: Building2,
            value: state.scope,
            options: [
              { value: "workspace", label: tFilters("scopeWorkspace") },
              { value: "owned", label: tFilters("scopeOwned") },
            ],
            onChange: (scope: string | null) =>
              void setState(
                { scope: scope === "owned" ? "owned" : "workspace" },
                { shallow: false },
              ),
          },
        ]
      : []),
    ...(!lockedProjectId && view !== "schedules"
      ? [
          {
            id: "source",
            label: t("source.label"),
            icon: FolderKanban,
            value: selectedSourceId,
            allLabel: t("source.all"),
            options: sources.map((source) => ({
              value: source.sourceId,
              label: source.displayName,
              avatarLabel: source.displayName,
              image: source.logoUrl,
            })),
            onChange: handleSourceChange,
          },
        ]
      : []),
    {
      id: "coworker",
      label: tFilters("coworkerLabel"),
      icon: Sparkles,
      value: state.assigneeId,
      allLabel: tFilters("all"),
      options: coworkers
        .filter((coworker) => coworker.kind !== "user")
        .map((coworker) => ({
          value: coworker.id,
          label: coworker.name,
          avatarLabel: coworker.name,
          image: coworker.image,
        })),
      onChange: (assigneeId: string | null) =>
        void setState({ assigneeId, assigneeUserId: null }, { shallow: false }),
    },
    {
      id: "human",
      label: tFilters("humanLabel"),
      icon: Sparkles,
      value: state.assigneeUserId,
      allLabel: tFilters("all"),
      options: coworkers
        .filter((coworker) => coworker.kind === "user")
        .map((coworker) => ({
          value: coworker.id,
          label: coworker.name,
          avatarLabel: coworker.name,
          image: coworker.image,
        })),
      onChange: (assigneeUserId: string | null) =>
        void setState({ assigneeUserId, assigneeId: null }, { shallow: false }),
    },
    {
      id: "status",
      label: tFilters("statusLabel"),
      icon: CircleDashed,
      value: state.status,
      allLabel: tFilters("all"),
      options: CALENDAR_STATUSES.map((status) => ({
        value: status,
        label: tFilters(`statusOptions.${status}`),
      })),
      onChange: (status: string | null) =>
        void setState(
          {
            status: isCalendarStatus(status) ? status : null,
          },
          { shallow: false },
        ),
    },
    {
      id: "timezone",
      label: t("timezone.label"),
      icon: Clock3,
      value: timeZone,
      options: getTimezoneOptions(timeZone).map((timezone) => ({
        value: timezone,
        label: timezone,
      })),
      onChange: (timezone: string | null) =>
        void setState(
          { timezone: isValidTimezone(timezone) ? timezone : null },
          { shallow: false },
        ),
    },
  ];

  return (
    <div className="flex w-full flex-col gap-5 pb-6">
      {currentUserId && workspaceId ? (
        <CalendarRealtimeBridge
          currentUserId={currentUserId}
          workspaceId={workspaceId}
          onAccessRevoked={handleCalendarAccessRevoked}
          onResync={handleCalendarResync}
          onInvalidated={handleCalendarInvalidated}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        {view === "month" || view === "week" ? (
          <div className="flex items-center gap-1">
            <Button
              aria-label={t("previous")}
              size="icon"
              variant="outline"
              onClick={() => handleNavigate(-1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="min-w-40 flex-1 text-center text-sm font-medium md:flex-none">
              {getRangeLabel(formatDate, date, view)}
            </span>
            <Button
              aria-label={t("next")}
              disabled={!canNavigateForward}
              size="icon"
              variant="outline"
              onClick={() => handleNavigate(1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        ) : null}

        <div className="ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:flex-nowrap">
          <Tabs
            className="min-w-0 max-w-full max-sm:flex-1"
            value={view}
            onValueChange={(value) => {
              const nextView = CALENDAR_VIEWS.find(
                (candidate) => candidate === value,
              );
              if (nextView) {
                handleViewChange(nextView);
              }
            }}
          >
            <TabsList
              className={cn(
                SEGMENTED_TABS_LIST_CLASS_NAME,
                "h-auto max-w-full w-fit flex-wrap max-sm:w-full max-sm:flex-nowrap max-sm:justify-start max-sm:gap-0 max-sm:overflow-x-auto",
              )}
              data-testid="calendar-views"
            >
              {CALENDAR_VIEWS.map((calendarView) => (
                <TabsTrigger
                  className={cn(
                    SEGMENTED_TAB_TRIGGER_CLASS_NAME,
                    "max-sm:px-1.5 max-sm:text-xs",
                  )}
                  key={calendarView}
                  value={calendarView}
                >
                  {t(`view.${calendarView}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div>
            <FilterDropdownMenu
              buttonLabel={tFilters("title")}
              emptyResultsLabel={tFilters("emptyResults")}
              searchPlaceholder={tFilters("searchPlaceholder")}
              sections={filterSections}
              showActiveIndicator={
                state.scope === "owned" ||
                state.assigneeId !== null ||
                state.assigneeUserId !== null ||
                state.status !== null ||
                (view !== "schedules" && selectedSourceId !== null)
              }
            />
          </div>
        </div>
      </div>
      {canCreate ? (
        <ListMobileCreateFab
          ariaLabel={t("create.fab")}
          onOpen={handleAgendaCreate}
        />
      ) : null}

      {view === "schedules" ? (
        <CalendarScheduleList
          currentUserId={currentUserId}
          hasMore={schedulesNextCursor !== null}
          isLoading={isLoadingSchedules}
          loadMoreError={schedulesLoadMoreError}
          onEditSchedule={(taskId) => void handleEventEdit(taskId)}
          onLoadMore={() => void loadNextSchedulesPage()}
          sources={sources}
          tasks={loadedSchedules}
          timeZone={timeZone}
        />
      ) : (
        <>
          {visibleItems.length === 0 && view !== "agenda" ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
              {t("empty.title")}
            </div>
          ) : null}
          <CalendarView
            key={calendarRenderEpoch}
            canCreate={canCreate}
            coworkers={coworkers}
            date={date}
            items={visibleItems}
            onDateClick={handleDateClick}
            onEventEdit={(taskId) => void handleEventEdit(taskId)}
            onMoveOccurrence={handleMoveOccurrence}
            onRestoreOccurrence={handleRestoreOccurrence}
            onSkipOccurrence={(item) => void handleSkipOccurrence(item)}
            onOpenTask={handleOpenTask}
            sources={sources}
            timeZone={timeZone}
            view={view}
          />
          {view === "agenda" && nextCursor ? (
            <div className="flex justify-center" ref={agendaBoundaryRef}>
              <Button
                variant="outline"
                size="sm"
                disabled={isLoadingOccurrences}
                onClick={() => void loadNextPage()}
              >
                {t(
                  isLoadingOccurrences
                    ? "agenda.loading"
                    : "schedules.loadMore",
                )}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {eventLoadError ? (
        <p className="text-destructive text-sm" role="alert">
          {t("edit.loadError")}
        </p>
      ) : null}
      {loadMoreError ? (
        <p className="text-destructive text-sm" role="alert">
          {t("pagination.error")}
        </p>
      ) : null}
      {editState ? (
        <CalendarEditDialog
          key={editState.requestId}
          initialSelection={editState.initialSelection}
          onClose={() =>
            setEditState((currentState) =>
              currentState?.requestId === editState.requestId
                ? null
                : currentState,
            )
          }
          task={editState.task}
          scheduleRevision={editState.scheduleRevision}
          futureExceptionCount={editState.futureExceptionCount}
        />
      ) : null}
      {timeState ? (
        <OccurrenceTimeDialog
          key={`${timeState.action}:${timeState.item.id}`}
          action={timeState.action}
          occurrenceId={timeState.item.id}
          expectedScheduleRevision={timeState.item.scheduleRevision}
          scheduledAt={
            timeState.action === "restore"
              ? (timeState.item.originalScheduledAt ??
                timeState.item.scheduledAt)
              : timeState.item.scheduledAt
          }
          taskId={timeState.item.taskId}
          timeZone={timeZone}
          onClose={() => setTimeState(null)}
        />
      ) : null}
    </div>
  );
}
