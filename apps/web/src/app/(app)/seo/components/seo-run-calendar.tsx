"use client";

import { format as formatDay, isSameDay, isValid, parseISO } from "date-fns";
import { enUS } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { labelDayButton } from "react-day-picker";
import { DATE_FNS_LOCALES } from "@/components/time-ago";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The form of a day in the filter. */
const DAY_FORMAT = "yyyy-MM-dd";
/**
 * A grey dot under the number of a day with a check: the accent is a fill only. On the filled first and last day
 * of a range it takes the text colour of that fill.
 */
const CHECK_DAY_CLASS =
  "after:bg-muted-foreground after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full [&:has([data-range-start=true])]:after:bg-primary-foreground [&:has([data-range-end=true])]:after:bg-primary-foreground [&:has([data-selected-single=true])]:after:bg-primary-foreground";

/** The day the page shows: the box today had before. */
const IN_VIEW_CLASS = "bg-accent text-accent-foreground rounded-md";
/** Today: a bold number, no box. The day button sets its own weight, so the bold goes on the button. */
const TODAY_CLASS = "[&>button]:font-semibold";

/**
 * "Other dates" at the end of the row of checks: a calendar under it. It opens on the month of the first check and marks
 * each day with a check. A day, then a second day, set the range; the page behind it follows each press.
 */
export function SeoRunCalendar({
  model,
  checkDays,
  shownDay,
  children,
}: {
  model: SeoWorkspaceModel;
  /** The UTC days with a check, newest first. */
  checkDays: string[];
  /** The UTC day the line of checks marks as in view; none while a range or a broken date is set. */
  shownDay?: string;
  /** The button that opens the calendar. */
  children: ReactNode;
}) {
  const t = useTranslations("App.Seo.runs");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { filters, setFilters } = model;
  const checks = checkDays.map((day) => parseISO(day));
  const from = seoFilterDay(filters.from);
  const to = seoFilterDay(filters.to);
  // A range of two days is set: the next press starts a new range, it does not stretch this one.
  const complete = Boolean(from && to && !isSameDay(from, to));
  // The filter compares UTC days: the UTC day of now is the last day with a check, also west of UTC.
  const today = parseISO(new Date().toISOString().slice(0, 10));
  // The day the line marks has the box, so both say one day. Today has none: a box on today read as "the page
  // shows today".
  const inView = shownDay ? parseISO(shownDay) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="range"
          locale={DATE_FNS_LOCALES[locale] ?? enUS}
          selected={from ? { from, to } : undefined}
          // A second press on the one day keeps it: "Show the latest" is the one way back.
          required
          // The range or check in view, else the first check: the reader sees how far back the checks go.
          defaultMonth={from ?? to ?? checks.at(-1)}
          // The UTC day for "today" too: the local day west of UTC put the bold mark a day early.
          today={today}
          endMonth={today}
          disabled={{ after: today }}
          modifiers={{ check: checks, inView: inView ? [inView] : [] }}
          modifiersClassNames={{
            check: CHECK_DAY_CLASS,
            inView: IN_VIEW_CLASS,
          }}
          classNames={{ today: TODAY_CLASS }}
          labels={{
            // The dot said in words too.
            labelDayButton: (date, modifiers, options, dateLib) => {
              const label = labelDayButton(date, modifiers, options, dateLib);
              return modifiers.check ? `${label}, ${t("checkDay")}` : label;
            },
          }}
          onSelect={(picked, day) => {
            const range = complete ? { from: day, to: day } : picked;
            void setFilters({
              from: range?.from ? formatDay(range.from, DAY_FORMAT) : null,
              to: range?.to ? formatDay(range.to, DAY_FORMAT) : null,
            });
            // A range of two days is done; the first press sets one day and keeps the calendar open.
            if (range?.from && range.to && !isSameDay(range.from, range.to))
              setOpen(false);
          }}
        />
        <div className="flex min-h-10 items-center justify-between gap-4 border-t px-3 text-xs">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <span
              aria-hidden
              className="bg-muted-foreground size-1.5 rounded-full"
            />
            {t("checkDay")}
          </span>
          {filters.from || filters.to ? (
            <button
              type="button"
              className="text-foreground focus-visible:ring-ring hit-area rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2"
              onClick={() => {
                setOpen(false);
                void setFilters({ from: null, to: null });
              }}
            >
              {t("latest")}
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A day of the filter as a local date for the calendar; a day the URL holds in another form is none. */
function seoFilterDay(day: string | null) {
  const date = day ? parseISO(day) : undefined;
  return date && isValid(date) ? date : undefined;
}
