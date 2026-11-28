"use client";

import { CalendarRange, Loader2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { useScrollChildIntoViewX } from "@/hooks/effects/use-scroll-child-into-view-x";
import { useScrollToEnd } from "@/hooks/effects/use-scroll-to-end";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { SeoReportFiles } from "./seo-report-files";
import { SeoRunCalendar } from "./seo-run-calendar";
import { SeoRunDayDialog, SeoRunDayHover } from "./seo-run-day";
import { seoRunDiffOf, seoStopCheckId } from "./seo-run-diff-model";
import {
  seoNextScheduledCheck,
  seoRunCountDays,
  seoRunDays,
  seoStopRuleCheck,
} from "./seo-runs-model";
import { seoRunProgress } from "./seo-setup-model";
import { seoStops } from "./seo-timeline-model";
import type { SeoReportFileProps } from "./use-seo-report-files";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const MINUTE_MS = 60_000;
/** The key of the stop that holds every event the page has. */
const WHOLE = "whole";
/** One stop of the timeline. The line runs through the middle of its dot, 7 px from the top. */
const STOP_CLASS =
  "relative flex min-w-24 flex-1 flex-col items-center pt-0.5 text-center";
const LINE_CLASS = "absolute top-[7px] h-0 border-t";
/** A day of the line: muted, bright while pressed. The pointer gives it a fill, so it reads as a control, not a label. */
const STOP_BUTTON_CLASS =
  "group text-muted-foreground hover:text-foreground hover:bg-accent aria-pressed:text-foreground focus-visible:ring-ring press relative -mt-1 flex min-h-10 flex-col items-center rounded-md px-2 pt-1 transition-colors outline-none focus-visible:ring-2 aria-pressed:font-medium";

/**
 * The checks of the site over the tabs, in a card of their own: the run on its title line, and a timeline of one
 * stop per day with its result, oldest on the left and the newest on the right, then a check in flight and the next
 * scheduled check. A press opens the preview, where the reader can choose the day or inspect its events. "Other dates" below the timeline opens a
 * calendar of the days with a check: both choose the time the page shows. It stands on every tab, so the days stand
 * at the same place on each.
 */
export function SeoRuns({
  model,
  shown,
  runButton,
  versions,
}: {
  model: SeoWorkspaceModel;
  /** The workspace decides once whether the line shows: it holds the date filter then. */
  shown: boolean;
  /** The run of the page; none on the Agent tab while its setup card leads. */
  runButton?: ReactNode;
  versions: SeoReportFileProps["versions"];
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const report = useSeoResultTranslations("App.Seo");
  const reportFormat = useSeoResultFormatter();
  const now = useNow({ updateInterval: MINUTE_MS });
  const { days, picked, checkDays, rangeCheck } = seoRunDays(
    model.data,
    model.filters,
  );
  // The stop whose details are open: what happened there, in a dialog over the page.
  // The day stays when the dialog closes, so its content does not empty while it fades.
  const [detailsDay, setDetailsDay] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openDetails = (day: string) => {
    setDetailsDay(day);
    setDetailsOpen(true);
  };
  const [previewDay, setPreviewDay] = useState<string | null>(null);
  const rangeTrigger = useRef<HTMLButtonElement>(null);
  function changePreview(day: string, open: boolean) {
    setPreviewDay((current) => (open ? day : current === day ? null : current));
  }
  // Core sends the events of the period in view only: with an older day picked, the newer stops hold nothing, so
  // their preview can still offer to load the day.
  // The stops the row shows: the oldest of them also holds the older days. The key stands for days, a new array
  // each render. One more stop holds every event the page has: the details of a range the reader set, where Core
  // sends the events of the range only.
  const shownDaysKey = days.map(({ day }) => day).join(",");
  const stopsByDay = useMemo(
    () =>
      new Map([
        ...seoStops(model.data, shownDaysKey ? shownDaysKey.split(",") : []),
        ...seoStops(model.data, [WHOLE]),
      ]),
    [model.data, shownDaysKey],
  );
  if (previewDay && !stopsByDay.has(previewDay)) setPreviewDay(null);
  const stopOf = (day: string) =>
    stopsByDay.get(day) ?? { after: null, newest: false, nodes: [] };
  // The button the details came from: the stop of the card, which is gone when the dialog closes, or the footer button.
  const returnTo = useRef<HTMLElement | null>(null);
  const progress = seoRunProgress(model.data, now);
  // The way back unmounts with its line: focus moves to the newest entry.
  const newestRef = useRef<HTMLButtonElement>(null);
  const line = useRef<HTMLOListElement>(null);
  const pickedDay = picked ? model.filters.to : null;
  const running = Boolean(progress);
  const titleId = useId();
  const next = shown ? seoNextScheduledCheck(model.data.monitors, now) : null;
  // On a phone the line scrolls sideways: its right end starts in view, with the newest day.
  useScrollToEnd(line, `${days.length}:${running}:${next !== null}`, {
    axis: "horizontal",
    enabled: days.length > 0,
  });
  // A picked older day comes into view; a pick already in view does not move the line.
  useScrollChildIntoViewX(
    line,
    () =>
      pickedDay
        ? line.current?.querySelector<HTMLElement>(
            `time[datetime="${pickedDay}"]`,
          )
        : null,
    pickedDay,
  );
  const showReports =
    versions.length > 0 ||
    (model.updating &&
      (model.data.observations.some((row) => row.sourceTaskId) ||
        model.data.analyses.some((row) => row.taskId)));
  if (!shown && !runButton && !showReports) return null;
  const dayOf = (at: Date, formatter = format) =>
    // The day of the filter: a run late in the evening west of UTC is on the next day.
    formatter.dateTime(at, { month: "short", day: "numeric", timeZone: "UTC" });
  const inView = days.find((entry) => entry.selected);
  const stops = days.toReversed();
  const countDays = seoRunCountDays(days);
  const { from, to } = model.filters;
  // A range the reader set in the calendar: no one check is in view then.
  const ranged = Boolean(from || (to && !picked));
  const utcDay = (day: string) => new Date(`${day}T00:00:00Z`);
  // A refetch can take the open stop off the row: the dialog closes with it.
  const details = detailsDay ? stopsByDay.get(detailsDay) : undefined;
  if (detailsOpen && !details) setDetailsOpen(false);
  if (previewDay === WHOLE && !ranged) setPreviewDay(null);
  // The stop whose details the footer opens: the day in view, or every event of a range.
  const detailsStop =
    !shown || model.invalidDates ? undefined : ranged ? WHOLE : inView?.day;
  // The check a stop compares: the newest page check of its day or range, else of its days, else any check.
  const checkOf = (stop: string) => {
    if (stop === WHOLE)
      return rangeCheck ?? seoStopCheckId(stopOf(WHOLE).nodes);
    const entry = days.find((item) => item.day === stop);
    const { after, newest } = stopOf(stop);
    return (
      entry?.check ??
      seoStopRuleCheck(model.data, after, newest ? null : stop) ??
      entry?.latest
    );
  };
  // A stop with no events can still hold a check that was stored after it: its comparison is worth opening.
  const comparesAt = (stop: string) =>
    Boolean(seoRunDiffOf(model.data, checkOf(stop) ?? undefined));
  const hasDetails = detailsStop
    ? stopOf(detailsStop).nodes.length > 0 || comparesAt(detailsStop)
    : false;
  // An invalid date in the address names no range: the line gives the way back alone.
  const rangeOf = (label = t, formatter = format) =>
    !ranged || model.invalidDates
      ? null
      : from
        ? label("runs.shown", {
            range: formatter.dateTimeRange(
              utcDay(from),
              to ? utcDay(to) : now,
              {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              },
            ),
          })
        : label("runs.shownUntil", { day: dayOf(utcDay(to ?? ""), formatter) });
  const rangeText = rangeOf();
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
    // The run stays on the title line on a phone too, so the card is short and the first step of the tab shows on
    // the first screen (owner, after pass 59). The footer has room for the full calendar label on phones.
    // The title keeps its own width: where a long run label leaves it no room (German, Spanish), the run wraps
    // to a row of its own.
    <section className={cn(HOLDER_CLASS, "flex flex-wrap items-center gap-2")}>
      {/* Under the audit name, the h2 of the page. */}
      <h3 id={titleId} className="px-2 py-1.5 text-sm font-semibold">
        {t("runs.label")}
      </h3>
      {showReports || runButton ? (
        <div className="ms-auto flex flex-wrap items-center gap-1">
          {showReports ? (
            <SeoReportFiles
              key={model.viewerKey}
              versions={versions}
              model={model}
            />
          ) : null}
          {runButton}
        </div>
      ) : null}
      {/* The date controls form one group, the run apart from it; the group adds no box of its own. */}
      <div
        role={shown ? "group" : undefined}
        aria-labelledby={shown ? titleId : undefined}
        className="contents"
      >
        {shown ? (
          <div
            // A fill without an outline: the checks card around it is the one frame. More room over the dots than
            // under the dates, so the line does not sit on the top edge.
            className="bg-background basis-full rounded-lg px-2 pt-5 pb-3 max-sm:pt-2 max-sm:pb-1"
          >
            <ol
              ref={line}
              role="list"
              // On a phone the line scrolls sideways in itself, without a scroll track. The days come in from the oldest.
              // The margin over it gives the dots room under the top edge of the box (owner: "margin top").
              className="app-scrollbar stagger -mx-1 mt-2 -mb-1 flex max-sm:mt-1 min-w-0 flex-1 overflow-x-auto p-1 text-sm max-sm:[scrollbar-width:none]"
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
                  <SeoRunDayHover
                    workspace={model.data}
                    day={dayOf(entry.at, reportFormat)}
                    nodes={stopOf(entry.day).nodes}
                    issues={entry.issues}
                    hasComparison={comparesAt(entry.day)}
                    pinned={previewDay === entry.day}
                    allowHover={!previewDay && !detailsOpen}
                    previewLabel={t("runs.previewOf", { day: dayOf(entry.at) })}
                    onPinnedChange={(open) => changePreview(entry.day, open)}
                    onSelectDay={
                      entry.selected && !ranged
                        ? undefined
                        : () =>
                            void model.setFilters({
                              from: null,
                              to: entry.newest ? null : entry.day,
                            })
                    }
                    selectLabel={t("runs.showDay", { day: dayOf(entry.at) })}
                    onDetails={() => {
                      returnTo.current =
                        line.current
                          ?.querySelector(`time[datetime="${entry.day}"]`)
                          ?.closest("button") ?? null;
                      openDetails(entry.day);
                    }}
                  >
                    <button
                      ref={entry.newest ? newestRef : undefined}
                      type="button"
                      aria-pressed={entry.selected}
                      aria-description={t("runs.previewOf", {
                        day: dayOf(entry.at),
                      })}
                      className={STOP_BUTTON_CLASS}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          // The ring in the page colour cuts the line around the dot.
                          "ring-background group-hover:ring-accent mb-1.5 size-2.5 rounded-full ring-4 transition-colors duration-150 motion-reduce:transition-none",
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
                        <span
                          lang="en"
                          className="text-muted-foreground text-xs font-normal"
                        >
                          {report("summary.issuesInCheck", {
                            count: entry.issues,
                          })}
                        </span>
                      )}
                      {entry.scheduled ? (
                        <span className="text-muted-foreground text-xs font-normal">
                          {t("runs.scheduled")}
                        </span>
                      ) : null}
                    </button>
                  </SeoRunDayHover>
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
                  <span
                    className={cn(
                      "relative flex min-h-10 flex-col items-center px-2",
                      progress.queued && "text-muted-foreground",
                    )}
                  >
                    {progress.queued ? (
                      // Accepted, not started: a hollow dashed dot, no spinner and no estimate.
                      <span
                        aria-hidden
                        className="border-muted-foreground bg-background ring-background mb-1.5 size-2.5 rounded-full border border-dashed ring-4"
                      />
                    ) : (
                      <Loader2
                        aria-hidden
                        className="bg-background -mt-[3px] mb-[3px] size-4 animate-spin rounded-full motion-reduce:animate-pulse"
                      />
                    )}
                    {progress.queued ? t("runs.queued") : t("runs.running")}
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
        {/* An earlier check or a range in view says so, with the way back, and fades in.
            It follows the timeline at every width, so a picked stop does not move under the finger. */}
        {shown ? (
          <p className="text-muted-foreground flex min-h-10 basis-full items-center px-2 text-xs empty:hidden md:min-h-8">
            {model.invalidDates ? (
              // The tab says why it is empty; the line gives the way back.
              latest
            ) : picked && inView ? (
              <span className="content-in">
                {t("runs.earlier", { day: dayOf(inView.at) })} {latest}
              </span>
            ) : ranged ? (
              <span className="content-in">
                {hasDetails && detailsStop === WHOLE && rangeText ? (
                  <SeoRunDayHover
                    workspace={model.data}
                    day={rangeOf(report, reportFormat) ?? rangeText}
                    nodes={stopOf(WHOLE).nodes}
                    previewLabel={rangeText}
                    pinned={previewDay === WHOLE}
                    allowHover={!previewDay && !detailsOpen}
                    onPinnedChange={(open) => changePreview(WHOLE, open)}
                    hasComparison={hasDetails}
                    onDetails={() => {
                      returnTo.current = rangeTrigger.current;
                      openDetails(WHOLE);
                    }}
                  >
                    <button
                      type="button"
                      ref={rangeTrigger}
                      className="hit-area focus-visible:ring-ring rounded-sm underline underline-offset-4 focus-visible:ring-2"
                    >
                      {rangeText}
                    </button>
                  </SeoRunDayHover>
                ) : (
                  rangeText
                )}{" "}
                {latest}
              </span>
            ) : null}
          </p>
        ) : null}
        {shown ? (
          <footer className="flex min-h-8 basis-full flex-wrap items-center gap-2 px-2">
            {/* A quiet control below the line: a stop in the line read as a third check. Centre the icon and label
                together because baseline alignment sets the calendar low. */}
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
          </footer>
        ) : null}
      </div>
      <SeoRunDayDialog
        workspace={model.data}
        open={detailsOpen}
        title={
          !detailsDay
            ? ""
            : detailsDay === WHOLE
              ? report("runs.details")
              : dayOf(utcDay(detailsDay), reportFormat)
        }
        description={
          details?.after
            ? report("runs.since", {
                day: dayOf(utcDay(details.after), reportFormat),
              })
            : detailsDay === WHOLE && rangeText
              ? (rangeOf(report, reportFormat) ?? "")
              : details?.newest
                ? report("runs.sinceAll")
                : report("runs.sinceStart")
        }
        nodes={details?.nodes ?? []}
        checkId={detailsDay ? checkOf(detailsDay) : undefined}
        onClose={() => setDetailsOpen(false)}
        onCloseAutoFocus={(event) => {
          // The dialog has no trigger: without a button to go back to, focus goes to the newest stop.
          event.preventDefault();
          (returnTo.current?.isConnected
            ? returnTo.current
            : newestRef.current
          )?.focus();
        }}
      />
    </section>
  );
}
