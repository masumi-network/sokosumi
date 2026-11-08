"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoStatisticsLostData } from "@sokosumi/utils";
import {
  Activity,
  BarChart3,
  CheckCheck,
  CircleAlert,
  FolderOpen,
  PencilLine,
  SearchCheck,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoDate, SeoEmpty, SeoSection, SeoState } from "./seo-shared";
import { seoCoverageIsNews } from "./seo-statistics-model";
import { buildSeoTimeline, foldSyncRuns } from "./seo-timeline-model";

/** Newest events shown before "Show all"; older history is rarely needed to decide what to do next. */
export const SEO_TIMELINE_VISIBLE = 5;

const icons = {
  audit: SearchCheck,
  check: CheckCheck,
  metrics: BarChart3,
  action: Activity,
  scope: FolderOpen,
  page_change: PencilLine,
};

/** Statuses worth a badge. A completed or recorded event needs no label. */
const FLAGGED_STATUSES = new Set([
  "requested",
  "running",
  "failed",
  "partial",
  "unavailable",
]);

export function SeoTimeline({
  workspace,
  onRetry,
}: {
  workspace: ProjectSeoWorkspace;
  onRetry?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const taskStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const [showAll, setShowAll] = useState(false);
  // The button unmounts on click; move focus to the first event it revealed.
  const firstRevealed = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (showAll) firstRevealed.current?.focus();
  }, [showAll]);
  // Syncs repeat every day; one row per run of them keeps checks and changes in view.
  const nodes = foldSyncRuns(buildSeoTimeline(workspace).reverse());
  // Metric ids are "<sync id>:<metric key>"; a sync event carries the sync id.
  const syncs = new Map(
    workspace.metrics.map((metric) => [metric.id.split(":")[0], metric]),
  );
  // Older syncs keep no metrics; their title still names the source.
  const titleSources = new Map(
    workspace.timeline.flatMap((event) => {
      const sync = syncs.get(event.observationId ?? "");
      return event.kind === "metrics" && sync
        ? [[event.title, sync.source] as const]
        : [];
    }),
  );
  const visible = showAll ? nodes : nodes.slice(0, SEO_TIMELINE_VISIBLE);
  return (
    <SeoSection title={t("timeline.title")}>
      {nodes.length === 0 ? (
        <SeoEmpty title={t("timeline.empty")} body={t("timeline.emptyBody")} />
      ) : (
        <div className={cn(HOLDER_ITEM_CLASS, "p-2")}>
          <ol aria-label={t("timeline.graphLabel")} className="divide-y">
            {visible.map(
              (
                { event, observation, at, isRecheck, label, syncs: runs },
                index,
              ) => {
                const status = event.status.toLowerCase();
                // A sync's status is its coverage; "unavailable" means nothing was read.
                const failed =
                  status === "failed" ||
                  (event.kind === "metrics" && status === "unavailable");
                const sync = syncs.get(event.observationId ?? "");
                // Search Console's usual filtering is not news (seoCoverageIsNews). An older
                // Search Console sync without saved metrics is judged by the notes in its detail.
                const quietSync =
                  event.kind === "metrics" &&
                  status === "partial" &&
                  (sync
                    ? !seoCoverageIsNews(sync)
                    : titleSources.get(event.title) === "search_console" &&
                      !seoStatisticsLostData(event.detail));
                const flagged = FLAGGED_STATUSES.has(status) && !quietSync;
                const Icon = failed ? CircleAlert : icons[event.kind];
                const hasSaveTime =
                  observation &&
                  new Date(observation.observedAt).getTime() !==
                    new Date(event.at).getTime();
                const incomplete =
                  observation &&
                  (observation.coverage.failed > 0 ||
                    (observation.coverage.modules?.failed ?? 0) > 0);
                return (
                  <li
                    key={event.id}
                    ref={
                      index === SEO_TIMELINE_VISIBLE ? firstRevealed : undefined
                    }
                    tabIndex={index === SEO_TIMELINE_VISIBLE ? -1 : undefined}
                    className="focus-visible:outline-ring flex gap-3 rounded-md px-2 py-3 focus-visible:outline-2"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                        failed
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h3 className="text-sm font-medium">
                          {event.kind === "metrics" && failed
                            ? t("timeline.metricsFailedTimes", {
                                count: runs,
                              })
                            : runs > 1
                              ? t("timeline.metricsSyncedTimes", {
                                  count: runs,
                                })
                              : t(`timeline.${label}`)}
                        </h3>
                        <span className="text-muted-foreground text-xs">
                          <SeoDate value={at} />
                        </span>
                      </div>
                      {event.kind === "action" &&
                      taskStatus.has(event.status) ? (
                        <SeoState>{taskStatus(event.status)}</SeoState>
                      ) : flagged && t.has(`timeline.statuses.${status}`) ? (
                        <SeoState>{t(`timeline.statuses.${status}`)}</SeoState>
                      ) : null}
                      {observation ? (
                        <p className="text-muted-foreground text-xs">
                          {t("timeline.checkSummary", {
                            checked: observation.coverage.checked,
                          })}
                          {" · "}
                          {t("pages.count", {
                            count: observation.pageIds.length,
                          })}
                          {observation.countryCode
                            ? ` · ${observation.countryCode} / ${observation.languageCode ?? t("none")}`
                            : ""}
                          {isRecheck ? ` · ${t("timeline.previousCheck")}` : ""}
                        </p>
                      ) : event.kind === "page_change" ? (
                        <p className="text-sm break-words">{event.title}</p>
                      ) : null}
                      {incomplete ? (
                        <p className="text-muted-foreground text-xs">
                          {t("timeline.incomplete")}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                        <details className="text-muted-foreground">
                          <summary className="cursor-pointer py-3 underline-offset-4 hover:underline">
                            {t("timeline.sourceDetails")}
                          </summary>
                          <div className="space-y-2 pt-2">
                            {hasSaveTime ? (
                              <div>
                                <span>{t("timeline.savedAt")}</span>{" "}
                                <SeoDate value={event.at} />
                              </div>
                            ) : null}
                            <p className="whitespace-pre-wrap break-words">
                              {event.detail}
                            </p>
                            {observation ? (
                              <p>
                                {observation.devices
                                  .map((device) => t(`analysis.${device}`))
                                  .join(", ")}
                                {" · "}
                                {t("timeline.rulebook", {
                                  version: observation.rulebookVersion,
                                })}
                              </p>
                            ) : null}
                          </div>
                        </details>
                        {event.taskId ? (
                          <Link
                            href={`/tasks/${encodeURIComponent(event.taskId)}`}
                            className="underline underline-offset-4"
                          >
                            {t("openTask")}
                          </Link>
                        ) : null}
                        {failed && event.kind === "check" && onRetry ? (
                          <Button variant="outline" size="sm" onClick={onRetry}>
                            {t("timeline.runNewCheck")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              },
            )}
          </ol>
          {nodes.length > visible.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setShowAll(true)}
            >
              {t("timeline.showAll", { count: nodes.length })}
            </Button>
          ) : null}
        </div>
      )}
    </SeoSection>
  );
}
