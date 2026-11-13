"use client";

import { CalendarRange, Loader2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { SeoRunCalendar } from "./seo-run-calendar";
import { seoRunCountDays, seoRunDays } from "./seo-runs-model";
import { seoRunProgress } from "./seo-setup-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const MINUTE_MS = 60_000;
/** One stop of the timeline. The line runs through the middle of its dot, 7 px from the top. */
const STOP_CLASS =
  "relative flex min-w-24 flex-1 flex-col items-center pt-0.5 text-center";
const LINE_CLASS = "absolute top-[7px] h-0 border-t";
/** A day and "Other dates" share the look: muted, bright on hover and while pressed, open or in use. */
const STOP_BUTTON_CLASS =
  "group text-muted-foreground hover:text-foreground aria-pressed:text-foreground data-[state=open]:text-foreground data-[active=true]:text-foreground data-[active=true]:font-medium focus-visible:ring-ring press relative flex min-h-10 flex-col items-center rounded-sm px-2 transition-colors outline-none focus-visible:ring-2 aria-pressed:font-medium";

/**
 * The runs of the site over the tabs as a timeline: one stop per day with its result, oldest on the left and
 * the newest on the right, a check in flight after it. A press shows the page as it was on that day. "Other
 * dates" at the end of the row, apart from the line, opens a calendar of the days with a check: both choose the time
 * the page shows. It stands on every tab, so the days stand at the same place on each.
 */
export function SeoRuns({
  model,
  shown,
}: {
  model: SeoWorkspaceModel;
  /** The workspace decides once whether the row shows: it holds the date filter then. */
  shown: boolean;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const now = useNow({ updateInterval: MINUTE_MS });
  const { days, picked, checkDays } = seoRunDays(model.data, model.filters);
  const progress = seoRunProgress(model.data, now);
  // The way back unmounts with its line: focus moves to the newest entry.
  const newestRef = useRef<HTMLButtonElement>(null);
  const line = useRef<HTMLOListElement>(null);
  const pickedDay = picked ? model.filters.to : null;
  const running = Boolean(progress);
  // On a phone the line scrolls sideways: its right end starts in view, with the newest day.
  useEffect(() => {
    const bar = line.current;
    if (bar && days.length) bar.scrollLeft = bar.scrollWidth;
  }, [days.length, running]);
  // A picked older day comes into view; a pick already in view does not move the line.
  useEffect(() => {
    const bar = line.current;
    const stop = pickedDay
      ? bar?.querySelector<HTMLElement>(`time[datetime="${pickedDay}"]`)
      : null;
    if (!bar || !stop) return;
    const outer = bar.getBoundingClientRect();
    const inner = stop.getBoundingClientRect();
    if (inner.left < outer.left) bar.scrollLeft -= outer.left - inner.left;
    else if (inner.right > outer.right)
      bar.scrollLeft += inner.right - outer.right;
  }, [pickedDay]);
  if (!shown) return null;
  const dayOf = (at: Date) =>
    // The day of the filter: a run late in the evening west of UTC is on the next day.
    format.dateTime(at, { month: "short", day: "numeric", timeZone: "UTC" });
  const inView = days.find((entry) => entry.selected);
  const stops = days.toReversed();
  const countDays = seoRunCountDays(days);
  const { from, to } = model.filters;
  // A range the reader set in the calendar: no one check is in view then.
  const ranged = Boolean(from || (to && !picked));
  const utcDay = (day: string) => new Date(`${day}T00:00:00Z`);
  const latest = (
    <button
      type="button"
      className="text-foreground focus-visible:ring-ring hit-area rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2"
      onClick={() => {
        newestRef.current?.focus();
        void model.setFilters({ from: null, to: null });
      }}
    >
      {t("runs.latest")}
    </button>
  );
  return (
    // Room above and under the line: it reads as its own row over the tabs, not as part of them.
    <div className="space-y-2 pt-1">
      <div
        role="group"
        aria-label={t("runs.label")}
        className="flex items-start gap-x-4"
      >
        <ol
          ref={line}
          role="list"
          // On a phone the line scrolls sideways in itself, without a scroll track. The days come in from the oldest.
          className="app-scrollbar stagger -m-1 flex min-w-0 flex-1 overflow-x-auto p-1 text-sm max-sm:[scrollbar-width:none]"
        >
          {stops.map((entry, index) => (
            <li key={entry.day} className={STOP_CLASS}>
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(LINE_CLASS, "border-border right-1/2 left-0")}
                />
              ) : null}
              {/* The line runs on to a later day or to the check in flight, dashed there: it is not done. It ends at
                  the newest check: a line on to "Other dates" read as a check still to come. */}
              {index < stops.length - 1 || running ? (
                <span
                  aria-hidden
                  className={cn(
                    LINE_CLASS,
                    "border-border right-0 left-1/2",
                    index === stops.length - 1 && "border-dashed",
                  )}
                />
              ) : null}
              <button
                ref={entry.newest ? newestRef : undefined}
                type="button"
                aria-pressed={entry.selected}
                // The run in view is bright with a bright neutral dot; the others are muted. No accent: it is a fill only.
                className={STOP_BUTTON_CLASS}
                onClick={() => {
                  void model.setFilters({
                    from: null,
                    to: entry.newest ? null : entry.day,
                  });
                }}
              >
                <span
                  aria-hidden
                  className={cn(
                    // The ring in the page colour cuts the line around the dot.
                    "ring-background mb-1.5 size-2.5 rounded-full ring-4 transition-colors duration-150 motion-reduce:transition-none",
                    entry.selected || entry.inRange
                      ? "bg-foreground"
                      : "bg-muted-foreground group-hover:bg-foreground",
                  )}
                />
                <time dateTime={entry.day}>{dayOf(entry.at)}</time>
                {entry.inRange ? (
                  <span className="sr-only">{t("runs.inRange")}</span>
                ) : null}
                {entry.issues === null || !countDays.has(entry.day) ? null : (
                  <span className="text-muted-foreground text-xs font-normal">
                    {t("pages.issues", { count: entry.issues })}
                  </span>
                )}
                {entry.scheduled ? (
                  <span className="text-muted-foreground text-xs font-normal">
                    {t("runs.scheduled")}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {progress ? (
            <li className={STOP_CLASS}>
              {stops.length ? (
                // Dashed: the run is not done.
                <span
                  aria-hidden
                  className={cn(
                    LINE_CLASS,
                    "border-border right-1/2 left-0 border-dashed",
                  )}
                />
              ) : null}
              <span className="relative flex min-h-10 flex-col items-center px-2">
                <Loader2
                  aria-hidden
                  className="bg-background -mt-[3px] mb-[3px] size-4 animate-spin rounded-full motion-reduce:animate-pulse"
                />
                {t("runs.running")}
                {progress.minutesLeft || progress.late ? (
                  <span className="text-muted-foreground text-xs">
                    {progress.minutesLeft
                      ? t("runs.left", { minutes: progress.minutesLeft })
                      : t("runs.late")}
                  </span>
                ) : null}
              </span>
            </li>
          ) : null}
        </ol>
        {/* Apart from the line and outside its scroll: always in view, a control, not a day. Its icon and word
            stand on the height of the dots and the days. */}
        <div className="shrink-0 pt-0.5 text-sm">
          <SeoRunCalendar
            model={model}
            checkDays={checkDays}
            shownDay={model.invalidDates || from ? undefined : inView?.day}
          >
            <button
              type="button"
              data-active={ranged}
              className={STOP_BUTTON_CLASS}
            >
              <CalendarRange
                aria-hidden
                className="-mt-[3px] mb-[3px] size-4"
              />
              {t("runs.dates")}
            </button>
          </SeoRunCalendar>
        </div>
      </div>
      {/* Always there, empty or not: a pick of a day or a range moves nothing under the line. An earlier check or
          a range in view says so, with the way back, and fades in. */}
      <p className="text-muted-foreground min-h-5 text-sm">
        {model.invalidDates ? (
          // The tab says why it is empty; the line gives the way back.
          latest
        ) : picked && inView ? (
          <span className="content-in">
            {t("runs.earlier", { day: dayOf(inView.at) })} {latest}
          </span>
        ) : ranged ? (
          <span className="content-in">
            {from
              ? t("runs.shown", {
                  range: format.dateTimeRange(
                    utcDay(from),
                    to ? utcDay(to) : now,
                    { month: "short", day: "numeric", timeZone: "UTC" },
                  ),
                })
              : t("runs.shownUntil", { day: dayOf(utcDay(to ?? "")) })}{" "}
            {latest}
          </span>
        ) : null}
      </p>
    </div>
  );
}
