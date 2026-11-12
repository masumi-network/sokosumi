"use client";

import { Loader2 } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { seoRunDays } from "./seo-runs-model";
import { seoRunProgress } from "./seo-setup-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const MINUTE_MS = 60_000;

/**
 * The runs of the site over the tabs: one entry per day with its result, the one in view marked, and a check
 * in flight first. A press shows the page as it was on that day. One run, with none in flight, is no choice.
 */
export function SeoRuns({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const now = useNow({ updateInterval: MINUTE_MS });
  const { days } = seoRunDays(model.data, model.filters);
  const progress = seoRunProgress(model.data, now);
  if (days.length + (progress ? 1 : 0) < 2) return null;
  return (
    // On a phone the row scrolls sideways in itself, without a scroll track.
    <div
      role="group"
      aria-label={t("runs.label")}
      className="app-scrollbar -m-1 flex items-center gap-1 overflow-x-auto p-1 max-sm:[scrollbar-width:none]"
    >
      {progress ? (
        <span className="border-border relative flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-md border px-3 text-sm max-sm:h-10">
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
              className="bg-primary absolute inset-x-0 bottom-0 h-0.5 origin-left transition-transform duration-500 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress.share})` }}
            />
          )}
        </span>
      ) : null}
      {days.map((entry) => (
        <Button
          key={entry.day}
          size="sm"
          variant={entry.selected ? "secondary" : "ghost"}
          aria-pressed={entry.selected}
          className="shrink-0 gap-1.5 font-normal aria-pressed:font-medium"
          onClick={() => {
            void model.setFilters({
              from: null,
              to: entry.newest ? null : entry.day,
            });
          }}
        >
          <time dateTime={entry.day}>
            {/* The day of the filter: a run late in the evening west of UTC is on the next day. */}
            {format.dateTime(entry.at, {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
          </time>
          {entry.issues === null ? null : (
            <span className="text-muted-foreground">
              {t("pages.issues", { count: entry.issues })}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}
