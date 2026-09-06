"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import classicTheme from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
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
import { type MouseEvent, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  clearTaskSchedule,
  createScheduledTask,
  saveCalendarTaskSchedule,
} from "@/lib/actions/task/action";
import { coreClient } from "@/lib/clients/core.browser.client";
import {
  type CreateScheduledTaskRequest,
  type Task,
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
import { metadataToSelection } from "@/lib/utils/task-schedule";

const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
const CALENDAR_STATUSES = Object.values(TaskStatus);

function isCalendarStatus(value: string | null): value is TaskStatusValue {
  return value !== null && CALENDAR_STATUSES.some((status) => status === value);
}
const SOURCE_PALETTE_CLASSES = {
  blue: "bg-chart-1",
  violet: "bg-chart-2",
  amber: "bg-chart-4",
} as const;

interface CalendarCoworker {
  id: string;
  image?: string;
  name: string;
}

interface WorkspaceCalendarProps {
  activeOrganizationId?: string | null;
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
}

const calendarParsers = {
  assigneeId: parseAsString,
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

function getCreateSource(
  source: WorkspaceCalendarSource | undefined,
): CreateScheduledTaskRequest["source"] | null {
  if (!source) {
    return null;
  }

  if (source.sourceType === "WORKSPACE") {
    return { type: "workspace" };
  }

  const projectId = getProjectIdFromSource(source);
  return projectId ? { type: "project", projectId } : null;
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
  view: (typeof CALENDAR_VIEWS)[number],
) {
  if (view === "week") {
    return `${formatDate(startOfWeek(date), { month: "short", day: "numeric" })} - ${formatDate(endOfWeek(date), { month: "short", day: "numeric", year: "numeric" })}`;
  }

  return formatDate(date, { month: "long", year: "numeric" });
}

function SourceMarker({
  decorative = false,
  size = "size-4",
  source,
  sourceName,
}: {
  decorative?: boolean;
  size?: string;
  source: WorkspaceCalendarSource | undefined;
  sourceName: string;
}) {
  if (source?.logoUrl) {
    return (
      <Avatar
        className={`${size} shrink-0 rounded-sm`}
        data-testid="calendar-source-marker"
      >
        <AvatarImage alt={decorative ? "" : sourceName} src={source.logoUrl} />
        <AvatarFallback aria-hidden={decorative} className="rounded-sm text-xs">
          {sourceName.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <span
      aria-hidden={decorative}
      aria-label={decorative ? undefined : sourceName}
      className={`${size} shrink-0 rounded-full ${
        source ? SOURCE_PALETTE_CLASSES[source.paletteToken] : "bg-primary"
      }`}
      data-testid="calendar-source-marker"
    />
  );
}

function CoworkerIdentity({ coworker }: { coworker: CalendarCoworker }) {
  return (
    <>
      <Avatar className="size-5 shrink-0">
        <AvatarImage alt="" src={coworker.image} />
        <AvatarFallback
          aria-hidden
          className="bg-primary text-primary-foreground text-xs"
        >
          {coworker.name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{coworker.name}</span>
    </>
  );
}

function SourceIdentity({ source }: { source: WorkspaceCalendarSource }) {
  return (
    <>
      <SourceMarker
        decorative
        size="size-5"
        source={source}
        sourceName={source.displayName}
      />
      <span className="truncate">{source.displayName}</span>
    </>
  );
}

function CalendarEvent({
  item,
  onEditSchedule,
  onOpenTask,
  showDetails,
  source,
}: {
  item: WorkspaceCalendarItem;
  onEditSchedule: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  showDetails: boolean;
  source: WorkspaceCalendarSource | undefined;
}) {
  const t = useTranslations("App.Calendar");
  const sourceName = source?.displayName ?? t(`source.${item.sourceType}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("event.accessibleName", {
            source: sourceName,
            task: item.taskName,
          })}
          className="bg-primary/10 text-foreground flex w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 py-1 text-left text-xs font-medium"
          type="button"
        >
          <SourceMarker decorative source={source} sourceName={sourceName} />
          {item.sourceAccuracy !== "EXACT" ? (
            <span
              aria-label={t(`accuracy.${item.sourceAccuracy.toLowerCase()}`)}
              className="text-muted-foreground shrink-0"
              role="img"
            >
              ~
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{item.taskName}</span>
          {showDetails ? (
            <>
              <span className="text-muted-foreground shrink-0">
                {sourceName}
              </span>
              {item.sourceAccuracy !== "EXACT" ? (
                <span className="text-muted-foreground shrink-0">
                  {t(`accuracy.${item.sourceAccuracy.toLowerCase()}`)}
                </span>
              ) : null}
            </>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {item.canEditSchedule ? (
          <DropdownMenuItem onSelect={() => onEditSchedule(item.taskId)}>
            {t("event.editSchedule")}
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
  date,
  items,
  onDateClick,
  onEventEdit,
  onOpenTask,
  sources,
  timeZone,
  view,
}: {
  date: Date;
  items: WorkspaceCalendarItem[];
  onDateClick: (date: Date) => void;
  onEventEdit: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  sources: WorkspaceCalendarSource[];
  timeZone: string;
  view: (typeof CALENDAR_VIEWS)[number];
}) {
  const pluginView = {
    month: "dayGridMonth",
    week: "timeGridWeek",
    agenda: "listMonth",
  }[view];

  return (
    <div
      className="workspace-calendar-theme overflow-x-auto"
      data-view={view}
      data-testid={`calendar-${view}`}
    >
      <FullCalendar
        key={`${getCalendarDayKey(date)}-${timeZone}-${view}`}
        plugins={[
          classicTheme,
          dayGridPlugin,
          interactionPlugin,
          timeGridPlugin,
          listPlugin,
        ]}
        initialDate={getCalendarDayKey(date)}
        initialView={pluginView}
        events={items.map((item) => ({
          id: item.id,
          title: item.taskName,
          start: item.scheduledAt.toISOString(),
        }))}
        timeZone={timeZone}
        allDaySlot={false}
        slotEventOverlap={false}
        headerToolbar={false}
        height="auto"
        editable={false}
        eventContent={(eventInfo) => {
          const item = items.find(({ id }) => id === eventInfo.event.id);
          return item ? (
            <CalendarEvent
              item={item}
              onEditSchedule={onEventEdit}
              onOpenTask={onOpenTask}
              showDetails={view === "agenda"}
              source={sources.find(
                ({ sourceId }) => sourceId === item.sourceId,
              )}
            />
          ) : (
            eventInfo.event.title
          );
        }}
        dateClick={(dateInfo) => onDateClick(dateInfo.date)}
      />
    </div>
  );
}

interface CalendarCreateDialogProps {
  coworkers: CalendarCoworker[];
  initialSelection: TaskScheduleSelection;
  lockedProjectId?: string;
  onClose: () => void;
  operationId: string;
  sources: WorkspaceCalendarSource[];
}

function CalendarCreateDialog({
  coworkers,
  initialSelection,
  lockedProjectId,
  onClose,
  operationId,
  sources,
}: CalendarCreateDialogProps) {
  const t = useTranslations("App.Calendar");
  const router = useRouter();
  const creatableSources = sources.filter(
    (source) =>
      source.isSchedulable &&
      (source.sourceType === "WORKSPACE" || source.sourceType === "PROJECT"),
  );
  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState(coworkers[0]?.id ?? "");
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selectedCoworker = coworkers.find(
    (coworker) => coworker.id === assigneeId,
  );
  const selectedSource = creatableSources.find(
    (source) => source.sourceId === sourceId,
  );

  const source = lockedProjectId
    ? getCreateSource(
        sources.find(
          (candidate) =>
            candidate.sourceId === `project:${lockedProjectId}` &&
            candidate.sourceType === "PROJECT" &&
            candidate.isSchedulable,
        ),
      )
    : getCreateSource(
        creatableSources.find((candidate) => candidate.sourceId === sourceId),
      );

  async function handleSave(schedule: TaskScheduleSelection) {
    if (!name.trim() || !assigneeId || (!lockedProjectId && !sourceId)) {
      setError(t("create.validationError"));
      return;
    }

    if (!source) {
      setError(t("create.sourceUnavailable"));
      return;
    }

    setError(null);
    try {
      const result = await createScheduledTask({
        operationId,
        source,
        name,
        assigneeId,
        schedule,
      });
      if (!result.ok) {
        setError(t("create.error"));
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t("create.error"));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="calendar-create-name">{t("create.name")}</Label>
            <Input
              id="calendar-create-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="calendar-create-assignee">
              {t("create.assignee")}
            </Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger
                aria-label={t("create.assignee")}
                id="calendar-create-assignee"
                className="w-full"
              >
                {selectedCoworker ? (
                  <CoworkerIdentity coworker={selectedCoworker} />
                ) : (
                  <SelectValue placeholder={t("create.assignee")} />
                )}
              </SelectTrigger>
              <SelectContent>
                {coworkers.map((coworker) => (
                  <SelectItem key={coworker.id} value={coworker.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <CoworkerIdentity coworker={coworker} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!lockedProjectId ? (
            <div className="space-y-2">
              <Label htmlFor="calendar-create-source">
                {t("create.source")}
              </Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger
                  aria-label={t("create.source")}
                  id="calendar-create-source"
                  className="w-full"
                >
                  {selectedSource ? (
                    <SourceIdentity source={selectedSource} />
                  ) : (
                    <SelectValue placeholder={t("create.source")} />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {creatableSources.map((sourceOption) => (
                    <SelectItem
                      key={sourceOption.sourceId}
                      value={sourceOption.sourceId}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <SourceIdentity source={sourceOption} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <TaskScheduleSection
            key={`${operationId}-${initialSelection.timezone}-${initialSelection.oneTimeLocalIso ?? ""}`}
            initialSelection={initialSelection}
            onCancel={onClose}
            onSave={handleSave}
            hideHeader
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CalendarEditDialogProps {
  initialSelection: TaskScheduleSelection;
  onClose: () => void;
  task: Task;
}

function CalendarEditDialog({
  initialSelection,
  onClose,
  task,
}: CalendarEditDialogProps) {
  const t = useTranslations("App.Calendar");
  const router = useRouter();
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [isClearingSchedule, setIsClearingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearRequestPending = useRef(false);

  async function handleSave(schedule: TaskScheduleSelection) {
    setError(null);
    try {
      const result = await saveCalendarTaskSchedule({
        taskId: task.id,
        schedule,
      });
      if (!result.ok) {
        setError(t("edit.saveError"));
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t("edit.saveError"));
    }
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
      const result = await clearTaskSchedule({ taskId: task.id });
      if (!result.ok) {
        setClearError(t("edit.clearError"));
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
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
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
            setClearConfirmationOpen(true);
          }}
          onSave={handleSave}
          canClearSchedule={initialSelection.mode !== "none"}
          hideHeader
        />
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

interface CalendarCreateState {
  initialSelection: TaskScheduleSelection;
  operationId: string;
}

interface CalendarEditState {
  initialSelection: TaskScheduleSelection;
  requestId: number;
  task: Task;
}

export function WorkspaceCalendar({
  activeOrganizationId = null,
  initialDate,
  items,
  latestDate,
  sources = [],
  pagination = null,
  range,
  coworkers = [],
  lockedProjectId,
}: WorkspaceCalendarProps) {
  const t = useTranslations("App.Calendar");
  const tFilters = useTranslations("App.Tasks.Filters");
  const formatDate = useFormatter().dateTime;
  const router = useRouter();
  const [state, setState] = useQueryStates(calendarParsers);
  const [loadedItems, setLoadedItems] = useState(items);
  const [nextCursor, setNextCursor] = useState(pagination?.nextCursor ?? null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [createState, setCreateState] = useState<CalendarCreateState | null>(
    null,
  );
  const [editState, setEditState] = useState<CalendarEditState | null>(null);
  const [eventLoadError, setEventLoadError] = useState(false);
  const eventRequestId = useRef(0);
  const date = parseCalendarDate(state.date ?? initialDate, initialDate);
  const timeZone = isValidTimezone(state.timezone)
    ? state.timezone
    : getDefaultTimezone();
  const view = state.view ?? "month";
  const selectedProjectId = lockedProjectId ? null : state.projectId;
  const selectedSourceId = lockedProjectId
    ? null
    : selectedProjectId
      ? `project:${selectedProjectId}`
      : state.sourceId;
  const canCreate = sources.some(
    (source) =>
      source.isSchedulable &&
      getCreateSource(source) !== null &&
      (!lockedProjectId || source.sourceId === `project:${lockedProjectId}`),
  );

  useMountEffect(() => {
    if (!isValidTimezone(state.timezone)) {
      void setState({ timezone: timeZone }, { shallow: false });
    }
  });

  const latestCalendarDate = latestDate
    ? parseCalendarDate(latestDate, initialDate)
    : null;
  const visibleItems = loadedItems
    .filter(
      (item) =>
        (state.assigneeId === null ||
          item.taskAssigneeId === state.assigneeId) &&
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

  function handleViewChange(view: (typeof CALENDAR_VIEWS)[number]) {
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
    setCreateState({
      initialSelection: {
        mode: "once",
        oneTimeLocalIso,
        timezone: timeZone,
      },
      operationId: crypto.randomUUID(),
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

  async function handleEventEdit(taskId: string) {
    const requestId = eventRequestId.current + 1;
    eventRequestId.current = requestId;
    setEventLoadError(false);
    try {
      const result = await coreClient.getTaskById(taskId);
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

  async function handleLoadMore() {
    if (!nextCursor || !range) {
      return;
    }

    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      const query = {
        from: range.from,
        to: range.to,
        cursor: nextCursor,
        limit: pagination?.limit ?? 100,
        scope: state.scope,
        assigneeId: state.assigneeId ?? undefined,
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
      setLoadedItems((currentItems) => [
        ...currentItems,
        ...result.data.filter(
          (item) => !currentItems.some(({ id }) => id === item.id),
        ),
      ]);
      setNextCursor(result.meta?.pagination?.nextCursor ?? null);
    } catch {
      setLoadMoreError(true);
    } finally {
      setIsLoadingMore(false);
    }
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
      options: coworkers.map((coworker) => ({
        value: coworker.id,
        label: coworker.name,
      })),
      onChange: (assigneeId: string | null) =>
        void setState({ assigneeId }, { shallow: false }),
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-6">
      <div className="flex items-center gap-1">
        <Button
          aria-label={t("previous")}
          size="icon"
          variant="outline"
          onClick={() => handleNavigate(-1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <span className="min-w-40 text-center text-sm font-medium">
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

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="hidden gap-1 md:flex"
          data-testid="desktop-calendar-views"
        >
          {CALENDAR_VIEWS.map((calendarView) => (
            <Button
              key={calendarView}
              size="sm"
              variant={view === calendarView ? "primary" : "outline"}
              onClick={() => handleViewChange(calendarView)}
            >
              {t(`view.${calendarView}`)}
            </Button>
          ))}
        </div>
        <div
          className="flex gap-1 md:hidden"
          data-testid="mobile-calendar-views"
        >
          {CALENDAR_VIEWS.filter((calendarView) => calendarView !== "week").map(
            (calendarView) => (
              <Button
                key={calendarView}
                size="sm"
                variant={view === calendarView ? "primary" : "outline"}
                onClick={() => handleViewChange(calendarView)}
              >
                {t(`view.${calendarView}`)}
              </Button>
            ),
          )}
        </div>
        <FilterDropdownMenu
          buttonLabel={tFilters("title")}
          emptyResultsLabel={tFilters("emptyResults")}
          searchPlaceholder={tFilters("searchPlaceholder")}
          sections={filterSections}
          showActiveIndicator={
            state.scope === "owned" ||
            state.assigneeId !== null ||
            state.status !== null ||
            selectedSourceId !== null
          }
        />
        {canCreate ? (
          <Button size="sm" variant="primary" onClick={handleAgendaCreate}>
            {t("create.title")}
          </Button>
        ) : null}
      </div>

      {visibleItems.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t("empty.title")}
        </div>
      ) : null}
      <div className="hidden md:block">
        <CalendarView
          date={date}
          items={visibleItems}
          onDateClick={handleDateClick}
          onEventEdit={(taskId) => void handleEventEdit(taskId)}
          onOpenTask={handleOpenTask}
          sources={sources}
          timeZone={timeZone}
          view={view}
        />
      </div>
      <div className="md:hidden">
        <CalendarView
          date={date}
          items={visibleItems}
          onDateClick={handleDateClick}
          onEventEdit={(taskId) => void handleEventEdit(taskId)}
          onOpenTask={handleOpenTask}
          sources={sources}
          timeZone={timeZone}
          view={view}
        />
      </div>
      {eventLoadError ? (
        <p className="text-destructive text-sm" role="alert">
          {t("edit.loadError")}
        </p>
      ) : null}
      {nextCursor ? (
        <div className="flex flex-col items-center gap-2">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isLoadingMore || !range}
          >
            {isLoadingMore ? t("pagination.loading") : t("pagination.loadMore")}
          </Button>
          {loadMoreError ? (
            <p className="text-destructive text-sm" role="alert">
              {t("pagination.error")}
            </p>
          ) : null}
        </div>
      ) : null}
      {createState ? (
        <CalendarCreateDialog
          coworkers={coworkers}
          initialSelection={createState.initialSelection}
          lockedProjectId={lockedProjectId}
          onClose={() => setCreateState(null)}
          operationId={createState.operationId}
          sources={sources}
        />
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
        />
      ) : null}
    </div>
  );
}
