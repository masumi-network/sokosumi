"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import listPlugin from "@fullcalendar/react/list";
import classicTheme from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
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
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useIsMobileMedia } from "@/hooks/use-mobile";
import { useMountEffect } from "@/hooks/use-mount-effect";
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
  isValidTimezone,
} from "@/lib/schedules/timezones";

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
  projectId?: string;
}

const calendarParsers = {
  assigneeId: parseAsString,
  date: parseAsString,
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
  source,
  sourceName,
}: {
  decorative?: boolean;
  source: WorkspaceCalendarSource | undefined;
  sourceName: string;
}) {
  if (source?.logoUrl) {
    return (
      <Avatar
        className="size-4 shrink-0 rounded-sm"
        data-testid="calendar-source-marker"
      >
        <AvatarImage alt={decorative ? "" : sourceName} src={source.logoUrl} />
        <AvatarFallback className="rounded-sm text-xs">
          {sourceName.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <span
      aria-hidden={decorative}
      aria-label={decorative ? undefined : sourceName}
      className={`size-1.5 shrink-0 rounded-full ${
        source ? SOURCE_PALETTE_CLASSES[source.paletteToken] : "bg-primary"
      }`}
      data-testid="calendar-source-marker"
    />
  );
}

function CalendarEvent({
  item,
  onNavigate,
  showDetails,
  source,
}: {
  item: WorkspaceCalendarItem;
  onNavigate: () => void;
  showDetails: boolean;
  source: WorkspaceCalendarSource | undefined;
}) {
  const t = useTranslations("App.Calendar");
  const sourceName = source?.displayName ?? t(`source.${item.sourceType}`);

  return (
    <span
      role="link"
      tabIndex={0}
      className="bg-primary/10 text-foreground flex w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 py-1 text-xs font-medium"
      onClick={(event) => {
        event.stopPropagation();
        onNavigate();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onNavigate();
        }
      }}
    >
      <SourceMarker source={source} sourceName={sourceName} />
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
          <span className="text-muted-foreground shrink-0">{sourceName}</span>
          {item.sourceAccuracy !== "EXACT" ? (
            <span className="text-muted-foreground shrink-0">
              {t(`accuracy.${item.sourceAccuracy.toLowerCase()}`)}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

function CalendarView({
  date,
  items,
  onNavigate,
  sources,
  timeZone,
  view,
}: {
  date: Date;
  items: WorkspaceCalendarItem[];
  onNavigate: (taskId: string) => void;
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
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, classicTheme]}
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
        eventContent={(eventInfo) => {
          const item = items.find(({ id }) => id === eventInfo.event.id);
          return item ? (
            <CalendarEvent
              item={item}
              onNavigate={() => onNavigate(item.taskId)}
              showDetails={view === "agenda"}
              source={sources.find(
                ({ sourceId }) => sourceId === item.sourceId,
              )}
            />
          ) : (
            eventInfo.event.title
          );
        }}
        eventClick={(eventInfo) => {
          const item = items.find(({ id }) => id === eventInfo.event.id);
          if (item) {
            onNavigate(item.taskId);
          }
        }}
      />
    </div>
  );
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
  projectId,
}: WorkspaceCalendarProps) {
  const t = useTranslations("App.Calendar");
  const tFilters = useTranslations("App.Tasks.Filters");
  const formatDate = useFormatter().dateTime;
  const router = useRouter();
  const [state, setState] = useQueryStates(calendarParsers);
  const isMobile = useIsMobileMedia();
  const [loadedItems, setLoadedItems] = useState(items);
  const [nextCursor, setNextCursor] = useState(pagination?.nextCursor ?? null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const date = parseCalendarDate(state.date ?? initialDate, initialDate);
  const timeZone = isValidTimezone(state.timezone)
    ? state.timezone
    : getDefaultTimezone();
  const view = state.view ?? (isMobile ? "agenda" : "month");

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
        (state.status === null || item.taskStatus === state.status),
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
      };
      const result = projectId
        ? await coreClient.getProjectsByIdCalendar(projectId, query)
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
            state.status !== null
          }
        />
      </div>

      {visibleItems.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t("empty.title")}
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <CalendarView
              date={date}
              items={visibleItems}
              onNavigate={(taskId) => router.push(`/tasks/${taskId}`)}
              sources={sources}
              timeZone={timeZone}
              view={view}
            />
          </div>
          <div className="md:hidden">
            <CalendarView
              date={date}
              items={visibleItems}
              onNavigate={(taskId) => router.push(`/tasks/${taskId}`)}
              sources={sources}
              timeZone={timeZone}
              view={view}
            />
          </div>
        </>
      )}
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
    </div>
  );
}
