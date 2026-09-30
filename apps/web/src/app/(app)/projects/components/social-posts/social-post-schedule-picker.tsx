"use client";

import {
  addDays,
  addMinutes,
  format,
  isBefore,
  nextMonday,
  setHours,
  startOfDay,
  startOfMinute,
} from "date-fns";
import { CalendarIcon, Clock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The composer's value: a local `yyyy-MM-ddTHH:mm`, or "" when unset. */
const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm";
const SLOT_MINUTES = 15;
const MORNING_HOUR = 9;

export function toScheduleValue(date: Date): string {
  return format(date, LOCAL_FORMAT);
}

function parseScheduleValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The first slot boundary at or after `date`. */
function ceilToSlot(date: Date): Date {
  const minute = startOfMinute(date);
  const over = minute.getMinutes() % SLOT_MINUTES;
  const rounded = over === 0 ? minute : addMinutes(minute, SLOT_MINUTES - over);
  return rounded < date ? addMinutes(rounded, SLOT_MINUTES) : rounded;
}

function atMorning(day: Date): Date {
  return setHours(startOfDay(day), MORNING_HOUR);
}

export type ScheduleQuickPick = "inAnHour" | "tomorrowMorning" | "nextMonday";

/**
 * The quick picks, from `now`: an hour out (on the next slot), tomorrow
 * morning, and next Monday morning. Each is a slot the time list offers too.
 */
export function scheduleQuickPicks(now: Date): Record<ScheduleQuickPick, Date> {
  return {
    inAnHour: ceilToSlot(addMinutes(now, 60)),
    tomorrowMorning: atMorning(addDays(now, 1)),
    nextMonday: atMorning(nextMonday(now)),
  };
}

/**
 * The day's 15-minute slots by wall clock, not by elapsed minutes, so a
 * daylight-saving day still runs 00:00 to 23:45: the hour that never
 * happens is skipped and the repeated one is listed once.
 */
export function scheduleSlotsOf(day: Date): Date[] {
  const slots: Date[] = [];
  for (
    let minuteOfDay = 0;
    minuteOfDay < 24 * 60;
    minuteOfDay += SLOT_MINUTES
  ) {
    const hours = Math.floor(minuteOfDay / 60);
    const minutes = minuteOfDay % 60;
    const slot = atWallClock(day, hours, minutes);
    // A time in the skipped hour rolls forward into the next one.
    if (slot.getHours() !== hours) continue;
    slots.push(slot);
  }
  return slots;
}

/** `day` at a wall-clock time, however long that day is. */
function atWallClock(day: Date, hours: number, minutes: number): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
  );
}

interface SocialPostSchedulePickerProps {
  /** Why the value is invalid, for `aria-describedby`. */
  describedBy?: string;
  disabled?: boolean;
  /** The earliest time a post may go out. */
  earliest: Date;
  invalid?: boolean;
  /** The visible label's id; the picker is one group under it. */
  labelledBy: string;
  onChange: (value: string) => void;
  value: string;
}

/**
 * When a post goes out: quick picks for the common times, then a date and a
 * time, each a button with a picker, rather than a typed `mm/dd/yyyy --:--`.
 * The time list runs in 15-minute slots; times before `earliest` are off.
 */
export function SocialPostSchedulePicker({
  describedBy,
  disabled,
  earliest,
  invalid,
  labelledBy,
  onChange,
  value,
}: SocialPostSchedulePickerProps) {
  const t = useTranslations("App.Projects.SocialPosts.composer.schedulePicker");
  const formatter = useFormatter();
  const quickPicksLabelId = useId();
  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const selected = parseScheduleValue(value);
  const quickPicks = scheduleQuickPicks(new Date());
  const earliestDay = startOfDay(earliest);

  function pickDate(day: Date | undefined): void {
    setDateOpen(false);
    if (!day) return;
    const hours = selected?.getHours() ?? MORNING_HOUR;
    const minutes = selected?.getMinutes() ?? 0;
    const next = atWallClock(day, hours, minutes);
    // A time already gone on that day moves to the first slot still open.
    onChange(
      toScheduleValue(isBefore(next, earliest) ? ceilToSlot(earliest) : next),
    );
  }

  function pickTime(slot: Date): void {
    setTimeOpen(false);
    onChange(toScheduleValue(slot));
  }

  // The time list is for the chosen day, or the earliest one.
  const slots = scheduleSlotsOf(selected ?? earliest);
  if (
    selected &&
    !slots.some((slot) => slot.getTime() === selected.getTime())
  ) {
    slots.push(selected);
    slots.sort((a, b) => a.getTime() - b.getTime());
  }

  return (
    <div
      aria-describedby={describedBy}
      aria-labelledby={labelledBy}
      className="space-y-2"
      role="group"
    >
      <div
        aria-labelledby={quickPicksLabelId}
        className="flex flex-wrap items-center gap-2"
        role="group"
      >
        <span className="sr-only" id={quickPicksLabelId}>
          {t("quickPicks")}
        </span>
        {(Object.keys(quickPicks) as ScheduleQuickPick[]).map((pick) => {
          const date = quickPicks[pick];
          const active = selected?.getTime() === date.getTime();
          return (
            <Button
              aria-pressed={active}
              className={cn(
                "rounded-full",
                active && "border-primary bg-primary-quinary",
              )}
              disabled={disabled || isBefore(date, earliest)}
              key={pick}
              onClick={() => onChange(toScheduleValue(date))}
              size="sm"
              type="button"
              variant="outline"
            >
              {t(`quick.${pick}`, {
                time: formatter.dateTime(date, "time"),
              })}
            </Button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <Button
              aria-invalid={invalid || undefined}
              aria-label={
                selected
                  ? t("dateSelected", {
                      date: formatter.dateTime(selected, { dateStyle: "full" }),
                    })
                  : t("pickDate")
              }
              className={cn(
                "w-full justify-start font-normal",
                !selected && "text-muted-foreground",
              )}
              disabled={disabled}
              type="button"
              variant="outline"
            >
              <CalendarIcon className="size-4" aria-hidden />
              {selected
                ? formatter.dateTime(selected, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : t("pickDate")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              autoFocus
              defaultMonth={selected ?? earliest}
              disabled={{ before: earliestDay }}
              mode="single"
              onSelect={pickDate}
              selected={selected ?? undefined}
            />
          </PopoverContent>
        </Popover>

        <Popover open={timeOpen} onOpenChange={setTimeOpen}>
          <PopoverTrigger asChild>
            <Button
              aria-invalid={invalid || undefined}
              aria-label={
                selected
                  ? t("timeSelected", {
                      time: formatter.dateTime(selected, "time"),
                    })
                  : t("pickTime")
              }
              className={cn(
                "w-full justify-start font-normal",
                !selected && "text-muted-foreground",
              )}
              disabled={disabled}
              type="button"
              variant="outline"
            >
              <Clock className="size-4" aria-hidden />
              {selected ? formatter.dateTime(selected, "time") : t("pickTime")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-1">
            <div
              aria-label={t("times")}
              className="app-scrollbar flex max-h-64 flex-col overflow-y-auto"
              role="listbox"
            >
              {slots.map((slot) => {
                const isSelected = selected?.getTime() === slot.getTime();
                const tooSoon = isBefore(slot, earliest);
                return (
                  <button
                    aria-disabled={tooSoon || undefined}
                    aria-selected={isSelected}
                    className={cn(
                      "hover:bg-muted focus-visible:ring-ring rounded-md px-2 py-1.5 text-start text-sm tabular-nums outline-none focus-visible:ring-2",
                      isSelected && "bg-primary-quinary font-medium",
                      tooSoon &&
                        "text-muted-foreground pointer-events-none opacity-50",
                    )}
                    disabled={tooSoon}
                    key={slot.getTime()}
                    onClick={() => pickTime(slot)}
                    // Open on the chosen time, or the first one still open.
                    ref={(node) => {
                      if (
                        node &&
                        (isSelected ||
                          (!selected &&
                            slot.getTime() === ceilToSlot(earliest).getTime()))
                      ) {
                        node.scrollIntoView?.({ block: "center" });
                      }
                    }}
                    role="option"
                    type="button"
                  >
                    {formatter.dateTime(slot, "time")}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
