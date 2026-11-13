"use client";

import { CalendarRange, Loader2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoRunCalendar } from "./seo-run-calendar";
import {
  seoNextScheduledCheck,
  seoRunCountDays,
  seoRunDays,
} from "./seo-runs-model";
import { seoRunProgress } from "./seo-setup-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const MINUTE_MS = 60_000;
/** One stop of the timeline. The line runs through the middle of its dot, 7 px from the top. */
const STOP_CLASS =
  "relative flex min-w-24 flex-1 flex-col items-center pt-0.5 text-center";
const LINE_CLASS = "absolute top-[7px] h-0 border-t";
/** A day of the line: muted, bright on hover and while pressed. */
const STOP_BUTTON_CLASS =
  "group text-muted-foreground hover:text-foreground aria-pressed:text-foreground focus-visible:ring-ring press relative flex min-h-10 flex-col items-center rounded-sm px-2 transition-colors outline-none focus-visible:ring-2 aria-pressed:font-medium";

/**
 * The checks of the site over the tabs, in a card of their own: the run on its title line, and a timeline of one
 * stop per day with its result, oldest on the left and the newest on the right, then a check in flight and the next
 * scheduled check. A press on a day shows the page as it was on that day. "Other dates" beside the title opens a
 * calendar of the days with a check: both choose the time the page shows. It stands on every tab, so the days stand
 * at the same place on each.
 */
export function SeoRuns({
  model,
  shown,
  runButton,
}: {
  model: SeoWorkspaceModel;
  /** The workspace decides once whether the line shows: it holds the date filter then. */
  shown: boolean;
  /** The run of the page; none on the Agent tab while its setup card leads. */
  runButton?: ReactNode;
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
  const titleId = useId();
  const next = shown ? seoNextScheduledCheck(model.data.monitors, now) : null;
  // On a phone the line scrolls sideways: its right end starts in view, with the newest day.
  useEffect(() => {
    const bar = line.current;
    if (bar && days.length) bar.scrollLeft = bar.scrollWidth;
  }, [days.length, running, next !== null]);
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
  if (!shown && !runButton) return null;
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
    // On a phone the run moves under the line, full width: the title line has no room for it there.
    <section className={cn(HOLDER_CLASS, "flex flex-wrap items-center gap-2")}>
      {/* The date controls form one group, the run apart from it; the group adds no box of its own. */}
      <div
        role={shown ? "group" : undefined}
        aria-labelledby={shown ? titleId : undefined}
        className="contents"
      >
        {/* Centred, not on the baseline: the date control is an icon and a word, so a baseline sets it low. */}
        <div className="order-1 flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 sm:flex-initial">
          {/* Under the audit name, the h2 of the page. */}
          <h3 id={titleId} className="text-sm font-semibold">
            {t("runs.label")}
          </h3>
          {shown ? (
            // A quiet control beside the title, not a stop of the line: a stop in the line read as a third check.
            <SeoRunCalendar
              model={model}
              checkDays={checkDays}
              shownDay={model.invalidDates || from ? undefined : inView?.day}
            >
              <button
                type="button"
                data-active={ranged}
                className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground data-[active=true]:text-foreground focus-visible:ring-ring hit-area inline-flex items-center gap-1 rounded-sm text-xs transition-colors outline-none focus-visible:ring-2"
              >
                <CalendarRange aria-hidden className="size-3.5" />
                {t("runs.dates")}
              </button>
            </SeoRunCalendar>
          ) : null}
        </div>
        {/* Beside the date controls: an earlier check or a range in view says so, with the way back, and fades in.
            On a phone it is the last row of the card, so a picked stop does not move under the finger. */}
        {shown ? (
          <p className="text-muted-foreground order-1 min-w-0 flex-1 px-2 text-xs empty:hidden max-sm:order-5 max-sm:basis-full sm:-ms-1">
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
                  : t("runs.shownUntil", {
                      day: dayOf(utcDay(to ?? "")),
                    })}{" "}
                {latest}
              </span>
            ) : null}
          </p>
        ) : null}
        {shown ? (
          <div
            // A fill without an outline: the checks card around it is the one frame. More room over the dots than
            // under the dates, so the line does not sit on the top edge.
            className="bg-background order-3 basis-full rounded-lg px-2 pt-5 pb-3"
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
                      className={cn(
                        LINE_CLASS,
                        "border-border right-1/2 left-0",
                      )}
                    />
                  ) : null}
                  {/* The line runs on to a later day, or dashed to the check in flight or the next scheduled one: those
                  are not done. */}
                  {index < stops.length - 1 || running || next ? (
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
                    {entry.issues === null ||
                    !countDays.has(entry.day) ? null : (
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
                  {next ? (
                    <span
                      aria-hidden
                      className={cn(
                        LINE_CLASS,
                        "border-border right-0 left-1/2 border-dashed",
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
              {next ? (
                // The next check a schedule starts: an open dot at the dashed end, not a day to pick.
                <li className={STOP_CLASS}>
                  <span
                    aria-hidden
                    className={cn(
                      LINE_CLASS,
                      "border-border right-1/2 left-0 border-dashed",
                    )}
                  />
                  <span className="text-muted-foreground relative flex min-h-10 flex-col items-center px-2">
                    <span
                      aria-hidden
                      className="border-muted-foreground bg-background ring-background mb-1.5 size-2.5 rounded-full border ring-4"
                    />
                    {/* The UTC day, as on every stop: a local day could read as the day of the newest check. */}
                    <time dateTime={next.toISOString().slice(0, 10)}>
                      {dayOf(next)}
                    </time>
                    <span className="text-xs">{t("runs.next")}</span>
                  </span>
                </li>
              ) : null}
            </ol>
          </div>
        ) : null}
      </div>
      {runButton ? (
        <div className="order-2 ms-auto max-sm:order-4 max-sm:basis-full max-sm:[&>div]:w-full">
          {runButton}
        </div>
      ) : null}
    </section>
  );
}
