"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Temporal } from "temporal-polyfill";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isoWeekOfRow } from "./iso-week";
import {
  SocialPostCalendarEvent,
  SocialPostStatusDot,
} from "./social-post-calendar-event";

/**
 * The composer slot a day's "+" asks for: 09:00 that day in the calendar's
 * zone, or the next whole hour there at least 15 minutes out when 09:00 has
 * gone. Returned as the same instant on the viewer's own clock, which is the
 * zone the composer reads its input in.
 */
export function composeSlotForDay(
  dayKey: string,
  timeZone: string,
  now = new Date(),
): string {
  const morning = Temporal.PlainDateTime.from(
    `${dayKey}T09:00`,
  ).toZonedDateTime(timeZone);
  const soonest = Temporal.Instant.fromEpochMilliseconds(
    now.getTime() + 15 * 60_000,
  ).toZonedDateTimeISO(timeZone);
  const slot =
    Temporal.ZonedDateTime.compare(morning, soonest) > 0
      ? morning
      : soonest.round({ smallestUnit: "hour", roundingMode: "ceil" });
  return format(new Date(slot.epochMilliseconds), "yyyy-MM-dd'T'HH:mm");
}

/** A failed or missed post waits on the reader to retry or reschedule it. */
function needsAttention(item: SocialPostCalendarItem): boolean {
  return item.status === "FAILED" || item.status === "MISSED";
}

/** One calendar day, labelled as itself whatever zone the formatter is in. */
function useDayLabel() {
  const formatDate = useFormatter().dateTime;
  return (dayKey: string, long = false) =>
    formatDate(new Date(`${dayKey}T12:00:00Z`), {
      weekday: long ? "long" : undefined,
      month: long ? "long" : "short",
      day: "numeric",
      timeZone: "UTC",
    });
}

/**
 * Starts a post on a calendar day. Only Social, where the composer exists,
 * gets one, and only on days a post can still go out.
 */
export function SocialDayAddButton({
  dayKey,
  timeZone,
  todayKey,
  className,
  size = "icon",
}: {
  dayKey: string;
  /** The calendar's zone: the day's 09:00 is read there. */
  timeZone: string;
  todayKey: string;
  className?: string;
  size?: "icon" | "label";
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const compose = useSocialCompose();
  const dayLabel = useDayLabel();
  if (!compose || dayKey < todayKey) return null;
  const label = t("newOnDay", { date: dayLabel(dayKey) });
  const open = () => compose.openAt(composeSlotForDay(dayKey, timeZone));
  if (size === "label") {
    return (
      <Button
        className={cn("min-h-11", className)}
        size="sm"
        type="button"
        variant="outline"
        aria-label={label}
        onClick={open}
      >
        <Plus aria-hidden className="size-4" />
        {t("newPost")}
      </Button>
    );
  }
  return (
    <button
      aria-label={label}
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring-halo hit-area flex size-6 shrink-0 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
        className,
      )}
      data-testid="calendar-day-add"
      // FullCalendar would read the click as a click on the day itself.
      onClick={(event) => {
        event.stopPropagation();
        open();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={label}
      type="button"
    >
      <Plus aria-hidden className="size-4" />
    </button>
  );
}

/**
 * Puts a day's "+" on a FullCalendar day cell or column header.
 *
 * FullCalendar hides the content it lets us draw there from screen readers
 * (it reads its own full date instead), and a button there would be focusable
 * but unnamed. So the slot only marks the spot: the button is portalled into
 * the cell itself, beside that hidden content, and takes its day from the
 * cell's `data-date` rather than from FullCalendar's zone-shifted dates.
 */
export function SocialDayAddSlot({
  className,
  timeZone,
  todayKey,
}: {
  className?: string;
  timeZone: string;
  todayKey: string;
}) {
  const { anchor, host } = useDayCell();
  const dayKey = host?.dataset.date;
  return (
    <>
      {anchor}
      {host && dayKey
        ? createPortal(
            <SocialDayAddButton
              className={className}
              dayKey={dayKey}
              timeZone={timeZone}
              todayKey={todayKey}
            />,
            host,
          )
        : null}
    </>
  );
}

/** The FullCalendar day cell a slot is drawn from, found through a hidden anchor. */
function useDayCell() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLSpanElement | null) => {
    setHost(element?.closest<HTMLElement>("[data-date]") ?? null);
  }, []);
  return { anchor: <span hidden ref={ref} />, host };
}

/**
 * A month row's ISO week number, in the gutter left of its first day.
 *
 * Drawn from that day's cell like the "+", and only by the cell that starts
 * its row. The visible number is decorative: the row itself is named for the
 * week, replacing the English label FullCalendar gives it with its own
 * (US-style) week count.
 */
export function SocialWeekNumberSlot() {
  const t = useTranslations("App.Calendar");
  const { anchor, host } = useDayCell();
  const row = host?.parentElement;
  const rowStartKey =
    row && row.firstElementChild === host ? host?.dataset.date : undefined;
  const week = rowStartKey ? isoWeekOfRow(rowStartKey) : null;
  const label = week === null ? null : t("weekNumber", { week });
  useEffect(() => {
    if (row && label) row.setAttribute("aria-label", label);
  }, [row, label]);
  return (
    <>
      {anchor}
      {host && week !== null
        ? createPortal(
            <span
              aria-hidden
              className="text-muted-foreground absolute end-full top-1 flex h-5 w-8 items-center justify-center text-2xs tabular-nums"
              data-testid="calendar-week-number"
              title={label ?? undefined}
            >
              {week}
            </span>,
            host,
          )
        : null}
    </>
  );
}

function SocialDayList({
  dayKey,
  heading,
  items,
  onReschedule,
  showProject,
  timeZone,
  todayKey,
}: {
  dayKey: string;
  heading: string;
  items: SocialPostCalendarItem[];
  onReschedule: (item: SocialPostCalendarItem) => void;
  showProject: boolean;
  timeZone: string;
  todayKey: string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  return (
    <section
      aria-label={heading}
      className="bg-background flex flex-col gap-2 rounded-lg border border-border p-3"
      data-testid="calendar-day-list"
    >
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h3
          className={cn(
            "text-sm font-semibold",
            dayKey === todayKey && "text-foreground",
          )}
        >
          {heading}
        </h3>
        <SocialDayAddButton
          dayKey={dayKey}
          size="label"
          timeZone={timeZone}
          todayKey={todayKey}
        />
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("dayEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <SocialPostCalendarEvent
                item={item}
                onReschedule={onReschedule}
                showProject={showProject}
                timeZone={timeZone}
                variant="week"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Social's calendar on a phone. Seven columns of cards do not fit a phone
 * width, so the month is a compact grid of days with a mark per post, and
 * the chosen day lists its posts underneath; the week lists its seven days.
 * There is no drag here: a post that can move carries a Reschedule button.
 */
export function SocialMobileCalendar({
  date,
  items,
  onReschedule,
  showProject,
  timeZone,
  todayKey,
  view,
  dayKeyOf,
}: {
  date: Date;
  items: SocialPostCalendarItem[];
  onReschedule: (item: SocialPostCalendarItem) => void;
  showProject: boolean;
  timeZone: string;
  todayKey: string;
  view: "month" | "week";
  dayKeyOf: (item: SocialPostCalendarItem) => string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const tCalendar = useTranslations("App.Calendar");
  const formatDate = useFormatter().dateTime;
  const dayLabel = useDayLabel();
  const byDay = Map.groupBy(items, dayKeyOf);
  const monthKey = format(date, "yyyy-MM");
  const [selected, setSelected] = useState(() =>
    todayKey.startsWith(monthKey) ? todayKey : format(date, "yyyy-MM-dd"),
  );

  if (view === "week") {
    const days = Array.from({ length: 7 }, (_, index) =>
      format(addDays(startOfWeek(date), index), "yyyy-MM-dd"),
    );
    return (
      <div className="flex flex-col gap-3" data-testid="calendar-week">
        {days.map((dayKey) => (
          <SocialDayList
            dayKey={dayKey}
            heading={dayLabel(dayKey, true)}
            items={byDay.get(dayKey) ?? []}
            key={dayKey}
            onReschedule={onReschedule}
            showProject={showProject}
            timeZone={timeZone}
            todayKey={todayKey}
          />
        ))}
      </div>
    );
  }

  const gridDays: string[] = [];
  for (
    let day = startOfWeek(startOfMonth(date));
    day <= endOfWeek(endOfMonth(date));
    day = addDays(day, 1)
  ) {
    gridDays.push(format(day, "yyyy-MM-dd"));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="calendar-month">
      <div className="bg-background border-quinary rounded-xl border p-2">
        {/* A phone has no room for the week numbers; a small tablet does. */}
        <div
          aria-hidden
          className="grid grid-cols-7 pb-1 sm:grid-cols-[1.5rem_repeat(7,minmax(0,1fr))]"
        >
          <span className="max-sm:hidden" />
          {gridDays.slice(0, 7).map((dayKey) => (
            <span
              className="text-muted-foreground text-center text-2xs font-medium"
              key={dayKey}
            >
              {formatDate(new Date(`${dayKey}T12:00:00Z`), {
                weekday: "narrow",
                timeZone: "UTC",
              })}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5 sm:grid-cols-[1.5rem_repeat(7,minmax(0,1fr))]">
          {gridDays.flatMap((dayKey, index) => {
            const dayItems = byDay.get(dayKey) ?? [];
            const attention = dayItems.filter(needsAttention).length;
            const inMonth = dayKey.startsWith(monthKey);
            const isSelected = dayKey === selected;
            const isToday = dayKey === todayKey;
            const week = index % 7 === 0 ? isoWeekOfRow(dayKey) : null;
            const day = (
              <button
                aria-label={[
                  dayLabel(dayKey, true),
                  t("dayCount", { count: dayItems.length }),
                  attention > 0
                    ? t("dayAttention", { count: attention })
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                aria-pressed={isSelected}
                className={cn(
                  "press focus-visible:ring-ring-halo flex min-h-12 cursor-pointer flex-col items-center gap-1 rounded-md py-1 text-xs tabular-nums outline-none focus-visible:ring-2 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
                  isSelected ? "bg-primary-quinary" : "hover:bg-muted",
                  !inMonth && "text-muted-foreground",
                )}
                data-testid="calendar-mobile-day"
                key={dayKey}
                onClick={() => setSelected(dayKey)}
                type="button"
              >
                {/* Today is a filled circle, as on the desktop grid. */}
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full",
                    isToday && "bg-primary text-primary-foreground",
                    (isToday || isSelected) && "font-semibold",
                  )}
                >
                  {Number(dayKey.slice(8))}
                </span>
                <span aria-hidden className="flex h-1.5 items-center gap-0.5">
                  {/* A post waiting on the reader is a diamond, not only a red dot. */}
                  {dayItems
                    .toSorted(
                      (a, b) =>
                        Number(needsAttention(b)) - Number(needsAttention(a)),
                    )
                    .slice(0, 3)
                    .map((item) => (
                      <SocialPostStatusDot key={item.id} status={item.status} />
                    ))}
                  {dayItems.length > 3 ? (
                    <span className="text-2xs leading-none">+</span>
                  ) : null}
                </span>
              </button>
            );
            return week === null
              ? [day]
              : [
                  <span
                    aria-hidden
                    className="text-muted-foreground flex h-8 items-center justify-center text-2xs tabular-nums max-sm:hidden"
                    data-testid="calendar-week-number"
                    key={`week-${dayKey}`}
                    title={tCalendar("weekNumber", { week })}
                  >
                    {week}
                  </span>,
                  day,
                ];
          })}
        </div>
      </div>
      <SocialDayList
        dayKey={selected}
        heading={dayLabel(selected, true)}
        items={byDay.get(selected) ?? []}
        onReschedule={onReschedule}
        showProject={showProject}
        timeZone={timeZone}
        todayKey={todayKey}
      />
    </div>
  );
}
