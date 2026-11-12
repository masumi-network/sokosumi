"use client";

import { Loader2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useRef } from "react";
import { seoRunDays } from "./seo-runs-model";
import { seoRunProgress } from "./seo-setup-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const MINUTE_MS = 60_000;

/**
 * The runs of the site over the tabs: one entry per day with its result, the one in view marked, and a check
 * in flight first. A press shows the page as it was on that day. One run, with none in flight, is no choice.
 * Quiet text, not a second tab bar: the tabs below are the one row of filled choices.
 */
export function SeoRuns({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const now = useNow({ updateInterval: MINUTE_MS });
  const { days, picked } = seoRunDays(model.data, model.filters);
  const progress = seoRunProgress(model.data, now);
  // The way back unmounts with its line: focus moves to the newest entry.
  const newestRef = useRef<HTMLButtonElement>(null);
  if (days.length + (progress ? 1 : 0) < 2) return null;
  const dayOf = (at: Date) =>
    // The day of the filter: a run late in the evening west of UTC is on the next day.
    format.dateTime(at, { month: "short", day: "numeric", timeZone: "UTC" });
  const inView = days.find((entry) => entry.selected);
  return (
    <div className="space-y-1">
      {/* On a phone the row scrolls sideways in itself, without a scroll track. */}
      <div
        role="group"
        aria-labelledby="seo-runs-label"
        className="app-scrollbar -m-1 flex items-center gap-x-4 overflow-x-auto p-1 text-sm max-sm:[scrollbar-width:none]"
      >
        <span id="seo-runs-label" className="text-muted-foreground shrink-0">
          {t("runs.label")}
        </span>
        {progress ? (
          <span className="relative flex h-8 shrink-0 items-center gap-1.5 overflow-hidden max-sm:h-10">
            <Loader2
              aria-hidden
              className="size-4 animate-spin motion-reduce:animate-pulse"
            />
            {t("runs.running")}
            {progress.minutesLeft || progress.late ? (
              <span className="text-muted-foreground">
                {progress.minutesLeft
                  ? t("runs.left", { minutes: progress.minutesLeft })
                  : t("runs.late")}
              </span>
            ) : null}
            {progress.share === null ? null : (
              // A picture only: the running line on the Agent tab is the bar that a screen reader announces.
              <span
                aria-hidden
                // Thin and muted: the 2px underline marks the run in view.
                className="bg-muted-foreground absolute inset-x-0 bottom-0 h-px origin-left transition-transform duration-500 ease-out motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress.share})` }}
              />
            )}
          </span>
        ) : null}
        {days.map((entry) => (
          <button
            key={entry.day}
            ref={entry.newest ? newestRef : undefined}
            type="button"
            aria-pressed={entry.selected}
            // The run in view is bright and underlined; the others are muted text.
            className="text-muted-foreground hover:text-foreground aria-pressed:text-foreground focus-visible:ring-ring press flex min-h-8 shrink-0 items-center gap-1.5 rounded-sm transition-colors outline-none focus-visible:ring-2 aria-pressed:font-medium max-sm:min-h-10"
            onClick={() => {
              void model.setFilters({
                from: null,
                to: entry.newest ? null : entry.day,
              });
            }}
          >
            <time
              dateTime={entry.day}
              className={
                entry.selected
                  ? "underline decoration-2 underline-offset-[6px]"
                  : undefined
              }
            >
              {dayOf(entry.at)}
            </time>
            {entry.issues === null ? null : (
              <span className="text-muted-foreground font-normal">
                {t("pages.issues", { count: entry.issues })}
              </span>
            )}
          </button>
        ))}
      </div>
      {picked && inView ? (
        // An earlier check in view says so, with the way back.
        <p className="content-rise text-muted-foreground text-sm">
          {t("runs.earlier", { day: dayOf(inView.at) })}{" "}
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
        </p>
      ) : null}
    </div>
  );
}
