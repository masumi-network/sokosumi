"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import {
  addDays,
  addMinutes,
  endOfMonth,
  endOfWeek,
  format,
  startOfHour,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { socialPostStatusTone } from "@/app/projects/components/social-posts/social-post-status-badge";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
import { Button } from "@/components/ui/button";
import { getToneStyle } from "@/components/ui/status-marker";
import { cn } from "@/lib/utils";
import { SocialPostCalendarEvent } from "./social-post-calendar-event";

/**
 * The composer slot a day's "+" asks for, in the viewer's own zone (the
 * composer's): 09:00 that day, or the next whole hour at least 15 minutes out
 * when 09:00 has gone.
 */
export function composeSlotForDay(dayKey: string, now = new Date()): string {
  const morning = `${dayKey}T09:00`;
  const soonest = addMinutes(now, 15);
  if (new Date(morning) > soonest) return morning;
  return format(startOfHour(addMinutes(soonest, 59)), "yyyy-MM-dd'T'HH:mm");
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
  todayKey,
  className,
  size = "icon",
}: {
  dayKey: string;
  todayKey: string;
  className?: string;
  size?: "icon" | "label";
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const compose = useSocialCompose();
  const dayLabel = useDayLabel();
  if (!compose || dayKey < todayKey) return null;
  const label = t("newOnDay", { date: dayLabel(dayKey) });
  const open = () => compose.openAt(composeSlotForDay(dayKey));
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
  todayKey,
}: {
  className?: string;
  todayKey: string;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const anchor = useCallback((element: HTMLSpanElement | null) => {
    setHost(element?.closest<HTMLElement>("[data-date]") ?? null);
  }, []);
  const dayKey = host?.dataset.date;
  return (
    <>
      <span hidden ref={anchor} />
      {host && dayKey
        ? createPortal(
            <SocialDayAddButton
              className={className}
              dayKey={dayKey}
              todayKey={todayKey}
            />,
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
  timeZone,
  todayKey,
}: {
  dayKey: string;
  heading: string;
  items: SocialPostCalendarItem[];
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
            dayKey === todayKey && "text-primary",
          )}
        >
          {heading}
        </h3>
        <SocialDayAddButton dayKey={dayKey} size="label" todayKey={todayKey} />
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("dayEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <SocialPostCalendarEvent
                item={item}
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
 * Rescheduling here goes through the post's preview, not a drag.
 */
export function SocialMobileCalendar({
  date,
  items,
  timeZone,
  todayKey,
  view,
  dayKeyOf,
}: {
  date: Date;
  items: SocialPostCalendarItem[];
  timeZone: string;
  todayKey: string;
  view: "month" | "week";
  dayKeyOf: (item: SocialPostCalendarItem) => string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
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
      <div className="bg-card-background rounded-xl p-2">
        <div aria-hidden className="grid grid-cols-7 pb-1">
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
        <div className="grid grid-cols-7 gap-0.5">
          {gridDays.map((dayKey) => {
            const dayItems = byDay.get(dayKey) ?? [];
            const inMonth = dayKey.startsWith(monthKey);
            const isSelected = dayKey === selected;
            return (
              <button
                aria-label={`${dayLabel(dayKey, true)}, ${t("dayCount", { count: dayItems.length })}`}
                aria-pressed={isSelected}
                className={cn(
                  "press focus-visible:ring-ring-halo flex min-h-12 cursor-pointer flex-col items-center gap-1 rounded-md py-1 text-sm tabular-nums outline-none focus-visible:ring-2 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                  !inMonth && !isSelected && "text-muted-foreground",
                  dayKey === todayKey &&
                    !isSelected &&
                    "text-primary font-semibold",
                )}
                data-testid="calendar-mobile-day"
                key={dayKey}
                onClick={() => setSelected(dayKey)}
                type="button"
              >
                <span>{Number(dayKey.slice(8))}</span>
                <span aria-hidden className="flex h-1.5 items-center gap-0.5">
                  {dayItems.slice(0, 3).map((item) => (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        isSelected
                          ? "bg-primary-foreground"
                          : getToneStyle(socialPostStatusTone(item.status)).dot,
                      )}
                      key={item.id}
                    />
                  ))}
                  {dayItems.length > 3 ? (
                    <span className="text-2xs leading-none">+</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <SocialDayList
        dayKey={selected}
        heading={dayLabel(selected, true)}
        items={byDay.get(selected) ?? []}
        timeZone={timeZone}
        todayKey={todayKey}
      />
    </div>
  );
}
