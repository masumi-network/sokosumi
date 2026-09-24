"use client";

import FullCalendar, { type EventDropInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { isValidTimezone } from "@sokosumi/utils";
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
  Repeat,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  parseAsString,
  parseAsStringEnum,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { useCreateTaskModal } from "@/app/tasks/components/create-task-modal";
import type { TaskAssigneeView } from "@/app/tasks/types/task-board";
import {
  TASK_SCHEDULES_PATH,
  taskSchedulePath,
} from "@/app/tasks/utils/task-schedule-view";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { Button } from "@/components/ui/button";
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
import { coreClient } from "@/lib/clients/core.browser.client";
import {
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
import { cn } from "@/lib/utils";
import { schedulableOnceLocalIso } from "@/lib/utils/task-schedule";
import {
  type ChangeableRun,
  changeRun,
  isChangeableRun,
  useReportRunChangeFailure,
} from "./run-change";
import { RunMoveDialog } from "./run-move-dialog";
import { SourceMarker } from "./source-marker";

const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
type CalendarView = (typeof CALENDAR_VIEWS)[number];
const CALENDAR_STATUSES = Object.values(TaskStatus);

function isCalendarStatus(value: string | null): value is TaskStatusValue {
  return value !== null && CALENDAR_STATUSES.some((status) => status === value);
}

export interface CalendarCoworker {
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
  view: CalendarView,
) {
  if (view === "week") {
    return `${formatDate(startOfWeek(date), { month: "short", day: "numeric" })} - ${formatDate(endOfWeek(date), { month: "short", day: "numeric", year: "numeric" })}`;
  }

  return formatDate(date, { month: "long", year: "numeric" });
}

/** A moved Run is planned at a time other than the rule's. */
function isMovedRun(item: WorkspaceCalendarItem): boolean {
  return (
    item.originalScheduledAt !== null &&
    item.originalScheduledAt.getTime() !== item.scheduledAt.getTime()
  );
}

interface RunHandlers {
  onMoveRun: (item: ChangeableRun) => void;
  onRestoreRun: (item: ChangeableRun) => void;
  onSkipRun: (item: ChangeableRun) => void;
  onOpen: (path: string) => void;
}

function CalendarEvent({
  item,
  people,
  onMoveRun,
  onRestoreRun,
  onSkipRun,
  onOpen,
  source,
  timeText,
}: RunHandlers & {
  item: WorkspaceCalendarItem;
  people: CalendarPeople;
  source: WorkspaceCalendarSource | undefined;
  timeText: string | undefined;
}) {
  const t = useTranslations("App.Calendar");
  const peopleId = useId();
  const { scheduleId } = item;
  const [menuOpen, setMenuOpen] = useState(false);
  // Where a mouse drag began on a card FullCalendar will not move.
  const dragAttemptOrigin = useRef<{ x: number; y: number } | null>(null);
  const sourceName = source?.displayName ?? t(`source.${item.sourceType}`);
  const sourceMarker = (
    <SourceMarker decorative source={source} sourceName={sourceName} />
  );
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
        aria-label={t("event.accessibleName", {
          source: sourceName,
          task: item.taskName,
        })}
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

  const cardClassName =
    "bg-background text-foreground hover:bg-muted border border-border flex w-full min-w-0 cursor-pointer select-none flex-col items-start gap-0.5 overflow-hidden rounded px-1.5 py-1 text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out";
  // FullCalendar silently ignores a drag on a Run the caller cannot move;
  // say which ones move once the mouse has clearly started.
  const dragAttemptHandlers = {
    onPointerDown: (event: PointerEvent) => {
      dragAttemptOrigin.current =
        event.pointerType !== "touch" && !isChangeableRun(item)
          ? { x: event.clientX, y: event.clientY }
          : null;
    },
    onPointerLeave: () => {
      dragAttemptOrigin.current = null;
    },
    onPointerMove: (event: PointerEvent) => {
      const origin = dragAttemptOrigin.current;
      if (
        !origin ||
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 8
      ) {
        return;
      }
      dragAttemptOrigin.current = null;
      toast.info(t("event.moveNotAllowed"));
    },
    onPointerUp: () => {
      dragAttemptOrigin.current = null;
    },
  };
  const cardContent = (trailing: ReactNode) => (
    <>
      <span className="flex w-full min-w-0 items-center gap-1">
        {sourceMarker}
        {timeText ? (
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {timeText}
          </span>
        ) : null}
        <span className="text-muted-foreground min-w-0 truncate">
          {sourceName}
        </span>
      </span>
      <span className="line-clamp-2 w-full min-w-0">{item.taskName}</span>
      <span className="flex w-full min-w-0 items-center gap-1">
        {peopleStack}
        {trailing}
      </span>
    </>
  );

  // A card with a Task (a released Run or a Run at) opens that Task. Only
  // Runs still to come, which have no Task yet, carry a menu.
  const { taskId } = item;
  if (taskId) {
    return (
      <button
        aria-describedby={peopleNames ? peopleId : undefined}
        aria-label={t("event.accessibleName", {
          source: sourceName,
          task: item.taskName,
        })}
        className={cn(
          cardClassName,
          "focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring outline-none focus-visible:ring-2",
        )}
        data-testid="calendar-event"
        onClick={() => onOpen(`/tasks/${taskId}`)}
        type="button"
        {...dragAttemptHandlers}
      >
        {cardContent(null)}
      </button>
    );
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      {/*
        The card is deliberately not the menu trigger: Radix opens on
        pointerdown and cancels the mousedown FullCalendar needs to start a
        drag. A click after a drop never lands here (the mouseup hits the
        drag mirror), so a click on the card is always a plain tap.
      */}
      <div
        className={cardClassName}
        data-testid="calendar-event"
        onClick={() => setMenuOpen(true)}
        {...dragAttemptHandlers}
      >
        {cardContent(menuButton)}
      </div>
      <DropdownMenuContent align="end">
        {isChangeableRun(item) ? (
          <>
            <DropdownMenuItem onSelect={() => onMoveRun(item)}>
              {t("event.moveRun")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSkipRun(item)}>
              {t("event.skipRun")}
            </DropdownMenuItem>
            {isMovedRun(item) ? (
              <DropdownMenuItem onSelect={() => onRestoreRun(item)}>
                {t("event.restoreRun")}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        {scheduleId ? (
          <DropdownMenuItem
            onSelect={() => onOpen(taskSchedulePath(scheduleId))}
          >
            {t("event.openSchedule")}
          </DropdownMenuItem>
        ) : null}
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
  runHandlers,
  sources,
  timeZone,
  view,
}: {
  canCreate: boolean;
  coworkers: CalendarCoworker[];
  date: Date;
  items: WorkspaceCalendarItem[];
  onDateClick: (date: Date) => void;
  runHandlers: RunHandlers;
  sources: WorkspaceCalendarSource[];
  timeZone: string;
  view: CalendarView;
}) {
  const router = useRouter();
  const formatDate = useFormatter().dateTime;
  const t = useTranslations("App.Calendar");
  const reportRunChangeFailure = useReportRunChangeFailure();
  // Optimistic overlay for an in-flight drop: the event renders at the time it
  // was dropped at until Core confirms it or the rollback removes it.
  const [pendingMoves, setPendingMoves] = useState<Record<string, Date>>({});
  const pluginView = {
    month: "dayGridMonth",
    week: "dayGridWeek",
  }[view === "agenda" ? "week" : view];

  function clearPendingMove(runId: string) {
    setPendingMoves((moves) => {
      const { [runId]: _dropped, ...rest } = moves;
      return rest;
    });
  }

  async function handleEventDrop(info: EventDropInfo) {
    const item = items.find(({ id }) => id === info.event.id);
    const scheduledAt = info.event.start;
    if (!item || !scheduledAt || !isChangeableRun(item)) {
      info.revert();
      return;
    }

    setPendingMoves((moves) => ({ ...moves, [item.id]: scheduledAt }));

    try {
      const result = await changeRun(item, { action: "move", scheduledAt });

      if (!result.ok) {
        clearPendingMove(item.id);
        info.revert();
        reportRunChangeFailure(result.error.kind);
        return;
      }

      router.refresh();
    } catch {
      clearPendingMove(item.id);
      info.revert();
      reportRunChangeFailure("failed");
    }
  }

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
                    {...runHandlers}
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
            // Per-event: a released or unowned Run is visible but not draggable.
            startEditable: isChangeableRun(item),
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
            return Boolean(item && isChangeableRun(item));
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
                {...runHandlers}
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
  workspaceId = null,
}: WorkspaceCalendarProps) {
  const t = useTranslations("App.Calendar");
  const tFilters = useTranslations("App.Tasks.Filters");
  const formatDate = useFormatter().dateTime;
  const router = useRouter();
  const { handleOpenWithDefaults } = useCreateTaskModal();
  const [state, setState] = useQueryStates(calendarParsers);
  const [loadedItems, setLoadedItems] = useState(items);
  const [nextCursor, setNextCursor] = useState(pagination?.nextCursor ?? null);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const agendaBoundaryRef = useRef<HTMLDivElement>(null);
  // The page already requested, keyed on the server items too so a refreshed
  // server page that reuses a cursor string drains again.
  const requestedPageRef = useRef<{
    cursor: string;
    items: WorkspaceCalendarItem[];
  } | null>(null);
  const [movingRun, setMovingRun] = useState<ChangeableRun | null>(null);
  const [calendarRenderEpoch, setCalendarRenderEpoch] = useState(0);
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
    // A request from the previous snapshot must not append stale Runs.
    calendarAccessGeneration.current += 1;
    setPrevItems(items);
    setPrevServerNextCursor(pagination?.nextCursor ?? null);
    setIsLoadingRuns(false);
    setLoadedItems(items);
    setNextCursor(pagination?.nextCursor ?? null);
    setLoadMoreError(false);
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

  const reportRunChangeFailure = useReportRunChangeFailure();

  async function handleRunChange(
    item: ChangeableRun,
    change: { action: "skip" | "restore" },
  ) {
    try {
      const result = await changeRun(item, change);
      if (!result.ok) {
        reportRunChangeFailure(result.error.kind);
        return;
      }
      router.refresh();
    } catch {
      reportRunChangeFailure("failed");
    }
  }

  const runHandlers: RunHandlers = {
    onMoveRun: setMovingRun,
    onRestoreRun: (item) => void handleRunChange(item, { action: "restore" }),
    onSkipRun: (item) => void handleRunChange(item, { action: "skip" }),
    onOpen: (path) => router.push(path),
  };

  async function loadNextPage() {
    if (!nextCursor || !range || isLoadingRuns) {
      return;
    }

    const accessGeneration = calendarAccessGeneration.current;
    setIsLoadingRuns(true);
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
        setIsLoadingRuns(false);
      }
    }
  }

  function handleCalendarAccessRevoked() {
    calendarAccessGeneration.current += 1;
    setLoadedItems([]);
    setNextCursor(null);
    setLoadMoreError(false);
    setMovingRun(null);
  }

  function handleCalendarInvalidated() {
    calendarAccessGeneration.current += 1;
  }

  function handleCalendarResync() {
    handleCalendarInvalidated();
    setLoadMoreError(false);
    setMovingRun(null);
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
      !isLoadingRuns &&
      !loadMoreError,
    boundaryKey: `${nextCursor}-${visibleItems.length}`,
    onVisible: () => void loadNextPage(),
  });

  function runFilterSections(): FilterDropdownMenuSection[] {
    return [
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
          void setState(
            { assigneeId, assigneeUserId: null },
            { shallow: false },
          ),
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
          void setState(
            { assigneeUserId, assigneeId: null },
            { shallow: false },
          ),
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
    ];
  }

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
    ...(!lockedProjectId
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
    ...runFilterSections(),
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
          <div className="flex items-center gap-1 max-sm:w-full">
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
          {lockedProjectId ? (
            <Button asChild size="sm" variant="outline">
              <Link
                href={`${TASK_SCHEDULES_PATH}?projectId=${encodeURIComponent(lockedProjectId)}`}
              >
                <Repeat aria-hidden className="size-4" />
                {t("schedules.link")}
              </Link>
            </Button>
          ) : null}
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
                selectedSourceId !== null
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
        runHandlers={runHandlers}
        sources={sources}
        timeZone={timeZone}
        view={view}
      />
      {view === "agenda" && nextCursor ? (
        <div className="flex justify-center" ref={agendaBoundaryRef}>
          <Button
            variant="outline"
            size="sm"
            disabled={isLoadingRuns}
            onClick={() => void loadNextPage()}
          >
            {t(isLoadingRuns ? "agenda.loading" : "agenda.loadMore")}
          </Button>
        </div>
      ) : null}
      {loadMoreError ? (
        <p className="text-destructive text-sm" role="alert">
          {t("pagination.error")}
        </p>
      ) : null}
      {movingRun ? (
        <RunMoveDialog
          key={movingRun.id}
          item={movingRun}
          timeZone={timeZone}
          onClose={() => setMovingRun(null)}
        />
      ) : null}
    </div>
  );
}
