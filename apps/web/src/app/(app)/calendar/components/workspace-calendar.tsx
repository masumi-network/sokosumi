"use client";

import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { Temporal } from "@js-temporal/polyfill";
import {
  addDays,
  addMonths,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { coreClient } from "@/lib/clients/core.browser.client";
import type {
  WorkspaceCalendarItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";

const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
const CALENDAR_TIME_ZONE = "UTC";
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
}

const calendarParsers = {
  coworker: parseAsString.withDefault("all"),
  date: parseAsString,
  source: parseAsString.withDefault(""),
  status: parseAsString.withDefault("all"),
  view: parseAsStringLiteral(CALENDAR_VIEWS).withDefault("month"),
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

export function getCalendarItemDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TIME_ZONE,
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
  source,
}: {
  item: WorkspaceCalendarItem;
  onNavigate: () => void;
  source: WorkspaceCalendarSource | undefined;
}) {
  const t = useTranslations("App.Calendar");
  const sourceName = source?.displayName ?? t(`source.${item.sourceType}`);

  return (
    <span
      role="link"
      tabIndex={0}
      className="bg-primary/10 text-foreground flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-medium"
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
      <span className="truncate">{item.taskName}</span>
      <span className="text-muted-foreground shrink-0">{sourceName}</span>
      {item.sourceAccuracy !== "EXACT" ? (
        <span className="text-muted-foreground shrink-0">
          {t(`accuracy.${item.sourceAccuracy.toLowerCase()}`)}
        </span>
      ) : null}
      {item.timeAccuracy === "APPROXIMATE" ? (
        <span className="text-muted-foreground shrink-0">
          {t("accuracy.approximate")}
        </span>
      ) : null}
    </span>
  );
}

function CalendarView({
  date,
  items,
  onNavigate,
  sources,
  view,
}: {
  date: Date;
  items: WorkspaceCalendarItem[];
  onNavigate: (taskId: string) => void;
  sources: WorkspaceCalendarSource[];
  view: (typeof CALENDAR_VIEWS)[number];
}) {
  const pluginView = {
    month: "dayGridMonth",
    week: "timeGridWeek",
    agenda: "listMonth",
  }[view];

  return (
    <div className="overflow-x-auto" data-testid={`calendar-${view}`}>
      <FullCalendar
        key={`${getCalendarDayKey(date)}-${view}`}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
        initialDate={getCalendarDayKey(date)}
        initialView={pluginView}
        events={items.map((item) => ({
          id: item.id,
          title: item.taskName,
          start: item.scheduledAt.toISOString(),
        }))}
        timeZone={CALENDAR_TIME_ZONE}
        headerToolbar={false}
        height="auto"
        eventContent={(eventInfo) => {
          const item = items.find(({ id }) => id === eventInfo.event.id);
          return item ? (
            <CalendarEvent
              item={item}
              onNavigate={() => onNavigate(item.taskId)}
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
  initialDate,
  items,
  latestDate,
  sources = [],
  pagination = null,
  range,
  coworkers = [],
}: WorkspaceCalendarProps) {
  const t = useTranslations("App.Calendar");
  const formatDate = useFormatter().dateTime;
  const router = useRouter();
  const [state, setState] = useQueryStates(calendarParsers);
  const [loadedItems, setLoadedItems] = useState(items);
  const [nextCursor, setNextCursor] = useState(pagination?.nextCursor ?? null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const date = parseCalendarDate(state.date ?? initialDate, initialDate);
  const latestCalendarDate = latestDate
    ? parseCalendarDate(latestDate, initialDate)
    : null;
  const visibleSourceIds = state.source ? state.source.split(",") : null;
  const taskStatuses = [...new Set(loadedItems.map((item) => item.taskStatus))];
  const visibleItems = loadedItems
    .filter(
      (item) =>
        visibleSourceIds === null || visibleSourceIds.includes(item.sourceId),
    )
    .filter(
      (item) => state.status === "all" || item.taskStatus === state.status,
    )
    .filter(
      (item) =>
        state.coworker === "all" || item.taskAssigneeId === state.coworker,
    )
    .sort(
      (left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime(),
    );

  function getNavigatedDate(direction: -1 | 1): Date {
    return state.view === "week"
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

  function handleSourceToggle(sourceId: string) {
    const selectedSourceIds =
      visibleSourceIds ?? sources.map((source) => source.sourceId);
    const nextSourceIds = selectedSourceIds.includes(sourceId)
      ? selectedSourceIds.filter((id) => id !== sourceId)
      : [...selectedSourceIds, sourceId];
    void setState({ source: nextSourceIds.join(",") });
  }

  async function handleLoadMore() {
    if (!nextCursor || !range) {
      return;
    }

    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      const result = await coreClient.getWorkspaceCalendar({
        from: range.from,
        to: range.to,
        cursor: nextCursor,
        limit: pagination?.limit ?? 100,
      });
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
          {getRangeLabel(formatDate, date, state.view)}
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
          {CALENDAR_VIEWS.map((view) => (
            <Button
              key={view}
              size="sm"
              variant={state.view === view ? "primary" : "outline"}
              onClick={() => handleViewChange(view)}
            >
              {t(`view.${view}`)}
            </Button>
          ))}
        </div>
        <div
          className="flex gap-1 md:hidden"
          data-testid="mobile-calendar-views"
        >
          {CALENDAR_VIEWS.filter((view) => view !== "week").map((view) => (
            <Button
              key={view}
              size="sm"
              variant={state.view === view ? "primary" : "outline"}
              onClick={() => handleViewChange(view)}
            >
              {t(`view.${view}`)}
            </Button>
          ))}
        </div>
        <div
          aria-label={t("source.label")}
          className="flex flex-wrap gap-1"
          role="group"
        >
          {sources.map((source) => {
            const isVisible =
              visibleSourceIds === null ||
              visibleSourceIds.includes(source.sourceId);
            return (
              <Button
                aria-pressed={isVisible}
                key={source.sourceId}
                size="sm"
                variant={isVisible ? "secondary" : "outline"}
                onClick={() => handleSourceToggle(source.sourceId)}
              >
                <SourceMarker
                  decorative
                  source={source}
                  sourceName={source.displayName}
                />
                {source.displayName}
              </Button>
            );
          })}
        </div>
        <Select
          value={state.status}
          onValueChange={(status) => void setState({ status })}
        >
          <SelectTrigger aria-label={t("status.label")} size="sm">
            <SelectValue placeholder={t("status.all")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("status.all")}</SelectItem>
            {taskStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`status.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={state.coworker}
          onValueChange={(coworker) => void setState({ coworker })}
        >
          <SelectTrigger aria-label={t("coworker.label")} size="sm">
            <SelectValue placeholder={t("coworker.all")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("coworker.all")}</SelectItem>
            {coworkers.map((coworker) => (
              <SelectItem key={coworker.id} value={coworker.id}>
                {coworker.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
              view={state.view}
            />
          </div>
          <div className="md:hidden">
            <CalendarView
              date={date}
              items={visibleItems}
              onNavigate={(taskId) => router.push(`/tasks/${taskId}`)}
              sources={sources}
              view={state.view === "week" ? "month" : state.view}
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
