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
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoDate, SeoEmpty, SeoSection, SeoState } from "./seo-shared";
import { seoCoverageIsNews } from "./seo-statistics-model";
import {
  buildSeoTimeline,
  foldCleanChecks,
  foldSyncRuns,
  type SeoTimelineNode,
} from "./seo-timeline-model";

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
  const format = useFormatter();
  // A check's own row says what it covered, in plain words; a gap is named only when there is one.
  function coverageText(
    coverage: ProjectSeoWorkspace["observations"][number]["coverage"],
  ) {
    return [
      t("timeline.rulesRan", { count: coverage.checked }),
      coverage.skipped
        ? t("timeline.rulesSkipped", { count: coverage.skipped })
        : null,
      coverage.failed
        ? t("timeline.rulesUnavailable", { count: coverage.failed })
        : null,
      coverage.modules?.failed
        ? t("timeline.optionalUnavailable", { count: coverage.modules.failed })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const taskStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const [showAll, setShowAll] = useState(false);
  // The button unmounts on click; move focus to the first event it revealed.
  const firstRevealed = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (showAll) firstRevealed.current?.focus();
  }, [showAll]);
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
  /**
   * A routine sync is housekeeping; "Last synced" on the Performance card already says when.
   * Only a sync that failed or lost data is history worth a row. Search Console's usual
   * filtering is not news (seoCoverageIsNews); an older Search Console sync without saved
   * metrics is judged by the notes in its detail.
   */
  function syncIsNews(event: ProjectSeoWorkspace["timeline"][number]) {
    const status = event.status.toLowerCase();
    if (status === "failed" || status === "unavailable") return true;
    if (status !== "partial") return false;
    const sync = syncs.get(event.observationId ?? "");
    return sync
      ? seoCoverageIsNews(sync)
      : titleSources.get(event.title) !== "search_console" ||
          seoStatisticsLostData(event.detail);
  }
  // A later routine sync of the same source recovered any older failure; the title names the source.
  const lastRoutine = new Map<string, number>();
  for (const event of workspace.timeline)
    if (event.kind === "metrics" && !syncIsNews(event))
      lastRoutine.set(
        event.title,
        Math.max(
          lastRoutine.get(event.title) ?? 0,
          new Date(event.at).getTime(),
        ),
      );
  const viewed = new Set(workspace.scope.pageIds);
  // A run leads with what it found; "no issues" needs a complete run that measured something.
  // Its issue count covers only the viewed pages, so a run with other pages shows no result.
  function resultOf({ observation }: SeoTimelineNode) {
    if (!observation || observation.coverage.checked === 0) return null;
    if (!observation.pageIds.every((id) => viewed.has(id))) return null;
    const incomplete =
      observation.coverage.failed > 0 ||
      (observation.coverage.modules?.failed ?? 0) > 0;
    return observation.issues > 0 || !incomplete ? observation.issues : null;
  }
  // Open failures fold into one row, and so do back-to-back clean checks.
  const synced = foldSyncRuns(
    buildSeoTimeline(workspace)
      .reverse()
      .filter(
        ({ event }) =>
          event.kind !== "metrics" ||
          (syncIsNews(event) &&
            new Date(event.at).getTime() > (lastRoutine.get(event.title) ?? 0)),
      ),
  );
  const nodes = foldCleanChecks(synced, (node) => resultOf(node) === 0);
  const visible = showAll ? nodes : nodes.slice(0, SEO_TIMELINE_VISIBLE);
  // The market only tells runs apart when they used different ones.
  const manyMarkets =
    new Set(
      workspace.observations.map(
        ({ countryCode, languageCode }) => `${countryCode}/${languageCode}`,
      ),
    ).size > 1;
  return (
    <SeoSection title={t("timeline.title")}>
      {nodes.length === 0 ? (
        <SeoEmpty title={t("timeline.empty")} body={t("timeline.emptyBody")} />
      ) : (
        <div className={cn(HOLDER_ITEM_CLASS, "p-2")}>
          <ol aria-label={t("timeline.graphLabel")} className="divide-y">
            {visible.map((node, index) => {
              const {
                event,
                observation,
                at,
                label,
                syncs: runs,
                earlier,
              } = node;
              const status = event.status.toLowerCase();
              // A sync's status is its coverage; "unavailable" means nothing was read.
              const failed =
                status === "failed" ||
                (event.kind === "metrics" && status === "unavailable");
              const flagged = FLAGGED_STATUSES.has(status);
              const Icon = failed ? CircleAlert : icons[event.kind];
              const incomplete =
                observation &&
                (observation.coverage.failed > 0 ||
                  (observation.coverage.modules?.failed ?? 0) > 0);
              const result = resultOf(node);
              // Earlier folded checks that covered another number of rules; the newest count is shown.
              const earlierRules = [
                ...new Set(
                  earlier
                    .map((check) => check.observation?.coverage.checked)
                    .filter(
                      (checked) =>
                        checked !== undefined &&
                        checked !== observation?.coverage.checked,
                    ),
                ),
              ];
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
                    {/* The date keeps its own line on a phone, so every row reads the same. */}
                    <div className="flex flex-col gap-y-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3">
                      <h3 className="text-sm font-medium">
                        {event.kind === "metrics" && failed
                          ? t("timeline.metricsFailedTimes", {
                              count: runs,
                            })
                          : runs > 1
                            ? t("timeline.metricsSyncedTimes", {
                                count: runs,
                              })
                            : earlier.length
                              ? t("timeline.cleanChecks", {
                                  count: earlier.length + 1,
                                })
                              : result !== null
                                ? t("timeline.result", { count: result })
                                : t(`timeline.${label}`)}
                      </h3>
                      <span className="text-muted-foreground text-xs">
                        {earlier.length ? (
                          // Folded checks name the days they span; one day keeps one date.
                          <>
                            {format.dateTimeRange(
                              Math.min(
                                ...earlier.map((check) =>
                                  new Date(check.at).getTime(),
                                ),
                              ),
                              new Date(at),
                              { dateStyle: "medium" },
                            )}
                          </>
                        ) : (
                          <SeoDate value={at} />
                        )}
                      </span>
                    </div>
                    {event.kind === "action" && taskStatus.has(event.status) ? (
                      <SeoState>{taskStatus(event.status)}</SeoState>
                    ) : flagged && t.has(`timeline.statuses.${status}`) ? (
                      <SeoState>{t(`timeline.statuses.${status}`)}</SeoState>
                    ) : null}
                    {observation ? (
                      <p className="text-muted-foreground text-xs">
                        {t("timeline.checkSummary", {
                          checked: observation.coverage.checked,
                        })}
                        {/* Devices tell rows with another rule count apart. */}
                        {observation.devices.length
                          ? ` · ${format.list(
                              observation.devices.map((device) =>
                                t(`analysis.${device}`),
                              ),
                            )}`
                          : ""}
                        {" · "}
                        {t("pages.count", {
                          count: observation.pageIds.length,
                        })}
                        {manyMarkets && observation.countryCode
                          ? ` · ${observation.countryCode} / ${observation.languageCode ?? t("none")}`
                          : ""}
                      </p>
                    ) : event.kind === "page_change" ? (
                      <p className="text-sm break-words">{event.title}</p>
                    ) : null}
                    {earlierRules.length ? (
                      <p className="text-muted-foreground text-xs">
                        {t("timeline.earlierRules", {
                          counts: earlierRules.join(", "),
                        })}
                      </p>
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
                          {/* A check's server detail repeats its coverage counts; the translated line below replaces it. */}
                          {observation ? null : (
                            <p className="whitespace-pre-wrap break-words">
                              {event.detail}
                            </p>
                          )}
                          {observation ? (
                            <p>
                              {/* A folded range hides the newest check's time; its line names it like the earlier ones. */}
                              {earlier.length ? (
                                <>
                                  <SeoDate value={at} />
                                  {" · "}
                                </>
                              ) : null}
                              {coverageText(observation.coverage)}
                              {event.taskId ? (
                                <>
                                  {" · "}
                                  <Link
                                    href={`/tasks/${encodeURIComponent(event.taskId)}`}
                                    className="inline-block py-3 text-foreground underline underline-offset-4"
                                  >
                                    {t("openTask")}
                                  </Link>
                                </>
                              ) : null}
                            </p>
                          ) : null}
                          {observation ? (
                            <p>
                              {t("timeline.rulebook", {
                                version: observation.rulebookVersion,
                              })}
                              {observation.coverage.modules?.notRequested
                                ? ` · ${t("timeline.optionalNotRequested", { count: observation.coverage.modules.notRequested })}`
                                : ""}
                            </p>
                          ) : null}
                          {earlier.map((check) => (
                            <p key={check.event.id}>
                              <SeoDate value={check.at} />
                              {check.observation
                                ? ` · ${coverageText(check.observation.coverage)}`
                                : ""}
                              {/* Folding ignores optional checks; name a count that differs from the newest. */}
                              {check.observation &&
                              (check.observation.coverage.modules
                                ?.notRequested ?? 0) !==
                                (observation?.coverage.modules?.notRequested ??
                                  0)
                                ? ` · ${t("timeline.optionalNotRequested", { count: check.observation.coverage.modules?.notRequested ?? 0 })}`
                                : ""}
                              {check.event.taskId ? (
                                <>
                                  {" · "}
                                  <Link
                                    href={`/tasks/${encodeURIComponent(check.event.taskId)}`}
                                    className="inline-block py-3 text-foreground underline underline-offset-4"
                                  >
                                    {t("openTask")}
                                  </Link>
                                </>
                              ) : null}
                            </p>
                          ))}
                          {/* A check's Task ends its coverage line above. */}
                          {event.taskId && !observation ? (
                            <Link
                              href={`/tasks/${encodeURIComponent(event.taskId)}`}
                              className="inline-block py-3 text-foreground underline underline-offset-4"
                            >
                              {t("openTask")}
                            </Link>
                          ) : null}
                        </div>
                      </details>
                      {failed && event.kind === "check" && onRetry ? (
                        <Button variant="outline" size="sm" onClick={onRetry}>
                          {t("timeline.runNewCheck")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
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
