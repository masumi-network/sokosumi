"use client";

import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkspaceCalendarItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
const CALENDAR_SOURCES = [
  "all",
  "WORKSPACE",
  "PROJECT",
  "LEGACY_UNKNOWN",
] as const;

interface CalendarCoworker {
  id: string;
  name: string;
}

interface WorkspaceCalendarProps {
  items: WorkspaceCalendarItem[];
  coworkers?: CalendarCoworker[];
}

const calendarParsers = {
  coworker: parseAsString.withDefault("all"),
  date: parseAsString.withDefault(format(new Date(), "yyyy-MM-dd")),
  source: parseAsStringLiteral(CALENDAR_SOURCES).withDefault("all"),
  status: parseAsString.withDefault("all"),
  view: parseAsStringLiteral(CALENDAR_VIEWS).withDefault("month"),
};

function parseCalendarDate(value: string): Date {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getRangeLabel(date: Date, view: (typeof CALENDAR_VIEWS)[number]) {
  if (view === "week") {
    return `${format(startOfWeek(date), "MMM d")} - ${format(endOfWeek(date), "MMM d, yyyy")}`;
  }

  return format(date, "MMMM yyyy");
}

function getCalendarItemLabel(item: WorkspaceCalendarItem) {
  return (
    <Link
      href={`/tasks/${item.taskId}`}
      className="bg-primary/10 text-foreground hover:bg-primary/15 block truncate rounded px-1.5 py-1 text-xs font-medium"
    >
      {item.taskName}
    </Link>
  );
}

function CalendarItemDetails({ item }: { item: WorkspaceCalendarItem }) {
  const t = useTranslations("App.Calendar");
  const formatter = useFormatter();

  return (
    <Link
      href={`/tasks/${item.taskId}`}
      className="border-border hover:bg-accent flex flex-col gap-1 rounded-lg border p-3 transition-colors"
    >
      <span className="font-medium">{item.taskName}</span>
      <span className="text-muted-foreground text-sm">
        {formatter.dateTime(item.scheduledAt, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </span>
      <span className="flex flex-wrap gap-1 text-xs">
        <span className="bg-muted rounded px-1.5 py-0.5">
          {t(`source.${item.sourceType}`)}
        </span>
        {item.sourceAccuracy !== "EXACT" ? (
          <span className="bg-muted rounded px-1.5 py-0.5">
            {t(`accuracy.${item.sourceAccuracy.toLowerCase()}`)}
          </span>
        ) : null}
        {item.timeAccuracy === "APPROXIMATE" ? (
          <span className="bg-muted rounded px-1.5 py-0.5">
            {t("accuracy.approximate")}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function MonthView({
  date,
  items,
}: {
  date: Date;
  items: WorkspaceCalendarItem[];
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(date)),
    end: endOfWeek(endOfMonth(date)),
  });

  return (
    <div className="overflow-x-auto" data-testid="calendar-month">
      <div className="grid min-w-160 grid-cols-7 border-l border-t">
        {eachDayOfInterval({
          start: startOfWeek(date),
          end: endOfWeek(date),
        }).map((day) => (
          <div
            key={day.toISOString()}
            className="bg-muted/40 border-b border-r p-2 text-center text-xs font-medium"
          >
            {format(day, "EEE")}
          </div>
        ))}
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={cn(
              "min-h-28 border-b border-r p-2",
              day.getMonth() !== date.getMonth() &&
                "bg-muted/20 text-muted-foreground",
            )}
          >
            <div className="mb-1 text-xs font-medium">{format(day, "d")}</div>
            <div className="space-y-1">
              {items
                .filter((item) => isSameDay(item.scheduledAt, day))
                .map((item) => (
                  <div key={item.id}>{getCalendarItemLabel(item)}</div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekView({
  date,
  items,
}: {
  date: Date;
  items: WorkspaceCalendarItem[];
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(date),
    end: endOfWeek(date),
  });

  return (
    <div className="overflow-x-auto" data-testid="calendar-week">
      <div className="grid min-w-160 grid-cols-7 border-l border-t">
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="border-b border-r p-2 text-center text-sm font-medium"
          >
            {format(day, "EEE d")}
          </div>
        ))}
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="min-h-96 border-b border-r p-2"
          >
            <div className="space-y-1">
              {items
                .filter((item) => isSameDay(item.scheduledAt, day))
                .map((item) => (
                  <div key={item.id}>{getCalendarItemLabel(item)}</div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgendaView({
  date,
  items,
}: {
  date: Date;
  items: WorkspaceCalendarItem[];
}) {
  const t = useTranslations("App.Calendar");
  const agendaItems = items.filter((item) =>
    isSameMonth(item.scheduledAt, date),
  );

  return (
    <ul className="space-y-3" data-testid="calendar-agenda">
      {agendaItems.map((item) => (
        <li key={item.id}>
          <CalendarItemDetails item={item} />
        </li>
      ))}
      {agendaItems.length === 0 ? (
        <li className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t("empty.title")}
        </li>
      ) : null}
    </ul>
  );
}

export function WorkspaceCalendar({
  items,
  coworkers = [],
}: WorkspaceCalendarProps) {
  const t = useTranslations("App.Calendar");
  const [state, setState] = useQueryStates(calendarParsers);
  const date = parseCalendarDate(state.date);
  const taskStatuses = [...new Set(items.map((item) => item.taskStatus))];
  const visibleItems = items
    .filter(
      (item) => state.source === "all" || state.source === item.sourceType,
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

  function handleNavigate(direction: -1 | 1) {
    const nextDate =
      state.view === "week"
        ? addDays(date, direction * 7)
        : addMonths(date, direction);
    void setState({ date: format(nextDate, "yyyy-MM-dd") }, { shallow: false });
  }

  function handleViewChange(view: (typeof CALENDAR_VIEWS)[number]) {
    void setState({ view }, { shallow: false });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("description")}
          </p>
        </div>
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
            {getRangeLabel(date, state.view)}
          </span>
          <Button
            aria-label={t("next")}
            size="icon"
            variant="outline"
            onClick={() => handleNavigate(1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
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
        <Select
          value={state.source}
          onValueChange={(source) =>
            void setState({
              source: source as (typeof CALENDAR_SOURCES)[number],
            })
          }
        >
          <SelectTrigger aria-label={t("source.label")} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CALENDAR_SOURCES.map((source) => (
              <SelectItem key={source} value={source}>
                {t(`source.${source}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            {state.view === "month" ? (
              <MonthView date={date} items={visibleItems} />
            ) : null}
            {state.view === "week" ? (
              <WeekView date={date} items={visibleItems} />
            ) : null}
            {state.view === "agenda" ? (
              <AgendaView date={date} items={visibleItems} />
            ) : null}
          </div>
          <div className="md:hidden">
            {state.view === "month" ? (
              <MonthView date={date} items={visibleItems} />
            ) : state.view === "week" ? (
              <WeekView date={date} items={visibleItems} />
            ) : (
              <AgendaView date={date} items={visibleItems} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
