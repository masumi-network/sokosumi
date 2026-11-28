"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
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
import { SEO_RESULT_LOCALE } from "@/i18n/seo-result-messages";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import {
  SeoDate,
  SeoFoldSummary,
  SeoMetaLine,
  SeoState,
  seoMarketName,
} from "./seo-shared";
import {
  type SeoStopNode,
  type SeoTimelineNode,
  seoNodeResult,
} from "./seo-timeline-model";

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

/** What happened at one stop of the runs row, one row per event. */
export function SeoTimeline({
  workspace,
  nodes,
}: {
  workspace: ProjectSeoWorkspace;
  /** The events of the stop, newest first. */
  nodes: SeoStopNode[];
}) {
  const t = useTranslations("App.Seo");
  const report = useSeoResultTranslations("App.Seo");
  const reportFormat = useSeoResultFormatter();
  // A gap in a check is named only when there is one; the row already says how much ran.
  function gapsOf(
    coverage: ProjectSeoWorkspace["observations"][number]["coverage"],
  ) {
    return [
      coverage.skipped
        ? report("timeline.rulesSkipped", { count: coverage.skipped })
        : null,
      coverage.failed
        ? report("timeline.rulesUnavailable", { count: coverage.failed })
        : null,
      coverage.modules?.failed
        ? report("timeline.optionalUnavailable", {
            count: coverage.modules.failed,
          })
        : null,
    ].filter((gap): gap is string => gap !== null);
  }
  // A check's Task holds its results; other events link to the Task itself.
  const taskLink = (taskId: string, check = false) => (
    <Link
      href={`/tasks/${encodeURIComponent(taskId)}`}
      className="inline-block py-3 text-foreground underline underline-offset-4"
    >
      {t(check ? "timeline.viewResults" : "openTask")}
    </Link>
  );
  const taskStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const viewed = new Set(workspace.scope.pageIds);
  const resultOf = (node: SeoTimelineNode) => seoNodeResult(workspace, node);
  // The market only tells runs apart when they used different ones. A crawl continuation has none.
  const manyMarkets =
    new Set(
      workspace.observations.flatMap(({ countryCode, languageCode }) =>
        countryCode ? [`${countryCode}/${languageCode}`] : [],
      ),
    ).size > 1;
  const onePage = workspace.scope.pageIds.length <= 1;
  return (
    <ol aria-label={t("timeline.graphLabel")} className="divide-y">
      {nodes.map((node) => {
        const { event, observation, at, label, syncs: runs, earlier } = node;
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
        const crawl =
          observation?.kind === "crawl_next"
            ? observation.siteCrawl
            : undefined;
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
          <li key={event.id} className="flex gap-3 px-2 py-3">
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                failed
                  ? "bg-quinary text-semantic-destructive"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              {/* The date keeps its own line on a phone, so every row reads the same. Dates are UTC days, as the stops of
                the runs row that group the rows; a UTC time would read as local. */}
              <div className="flex flex-col gap-y-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3">
                <h3 lang="en" className="text-sm font-medium">
                  {event.kind === "metrics" && failed
                    ? report("timeline.metricsFailedTimes", {
                        count: runs,
                      })
                    : runs > 1
                      ? report("timeline.metricsSyncedTimes", {
                          count: runs,
                        })
                      : earlier.length
                        ? report("timeline.cleanChecks", {
                            count: earlier.length + 1,
                          })
                        : result !== null
                          ? report("timeline.result", { count: result })
                          : report(`timeline.${label}`)}
                </h3>
                <span className="text-muted-foreground text-xs">
                  {earlier.length ? (
                    // Folded checks name the days they span; one day keeps one date.
                    <span lang="en">
                      {reportFormat.dateTimeRange(
                        Math.min(
                          ...earlier.map((check) =>
                            new Date(check.at).getTime(),
                          ),
                        ),
                        new Date(at),
                        { dateStyle: "medium", timeZone: "UTC" },
                      )}
                    </span>
                  ) : observation && event.taskId ? (
                    // The date opens the results of the check: its Task is the record behind the row.
                    // The link has a 40 px hit area on a phone; the negative margin keeps the line in place.
                    <Link
                      href={`/tasks/${encodeURIComponent(event.taskId)}`}
                      className="-my-3 inline-block py-3 underline underline-offset-4"
                    >
                      <SeoDate report day value={at} timeZone="UTC" />
                      {/* A date alone does not say where the link leads. */}
                      <span className="sr-only">
                        , {t("timeline.viewResults")}
                      </span>
                    </Link>
                  ) : (
                    <SeoDate report day value={at} timeZone="UTC" />
                  )}
                </span>
              </div>
              {event.kind === "action" && taskStatus.has(event.status) ? (
                <SeoState>{taskStatus(event.status)}</SeoState>
              ) : flagged && t.has(`timeline.statuses.${status}`) ? (
                <SeoState>
                  <span lang="en">{report(`timeline.statuses.${status}`)}</span>
                </SeoState>
              ) : null}
              {observation ? (
                // The facts wrap fact by fact: on a phone a line ended with a dot.
                <div lang="en">
                  <SeoMetaLine
                    className="text-xs"
                    items={[
                      // A crawl continuation runs no rules on its seed page: it reads the next pages of the site.
                      [
                        "tests",
                        crawl
                          ? crawl.state === "crawled"
                            ? report("timeline.crawlSummary", {
                                read: crawl.read,
                              })
                            : null
                          : report(
                              // Folded checks that all ran the same count say it is per check.
                              earlier.length && !earlierRules.length
                                ? "timeline.checkSummaryEach"
                                : "timeline.checkSummary",
                              { checked: observation.coverage.checked },
                            ),
                      ],
                      // Devices tell rows with another rule count apart.
                      [
                        "devices",
                        observation.devices.length
                          ? reportFormat.list(
                              observation.devices.map((device) =>
                                report("timeline.device", { device }),
                              ),
                            )
                          : null,
                      ],
                      // A one-page Audit needs no page count on every row.
                      [
                        "pages",
                        crawl ||
                        (onePage &&
                          observation.pageIds.length === 1 &&
                          viewed.has(observation.pageIds[0]))
                          ? null
                          : report("pages.count", {
                              count: observation.pageIds.length,
                            }),
                      ],
                      // One check names its gaps next to the count they belong to.
                      ...(earlier.length
                        ? []
                        : gapsOf(observation.coverage)
                      ).map((gap): [string, string] => [gap, gap]),
                      [
                        "market",
                        manyMarkets && observation.countryCode
                          ? seoMarketName(
                              SEO_RESULT_LOCALE,
                              observation.countryCode,
                              observation.languageCode,
                            )
                          : null,
                      ],
                    ]}
                  />
                </div>
              ) : event.kind === "page_change" ? (
                <p className="text-sm break-words">{event.title}</p>
              ) : null}
              {earlierRules.length ? (
                <p lang="en" className="text-muted-foreground text-xs">
                  {report("timeline.earlierRules", {
                    counts: earlierRules.join(", "),
                  })}
                </p>
              ) : null}
              {incomplete ? (
                <p lang="en" className="text-muted-foreground text-xs">
                  {report("timeline.incomplete")}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs empty:hidden">
                {observation && !earlier.length ? null : (
                  // One check needs no details: its date opens its results.
                  <details className="text-muted-foreground">
                    <SeoFoldSummary className="py-3 underline-offset-4 hover:underline">
                      {/* Folded checks open to a list of the checks, each with its own results link. */}
                      {observation
                        ? t("timeline.viewEachResult", {
                            count: earlier.length + 1,
                          })
                        : t("timeline.sourceDetails")}
                    </SeoFoldSummary>
                    <div className="space-y-2 pt-2">
                      {observation ? (
                        // Folded checks, newest first: each keeps its time, its gaps and its Task.
                        [
                          {
                            id: event.id,
                            at,
                            observation,
                            taskId: event.taskId,
                          },
                          ...earlier.map((check) => ({
                            id: check.event.id,
                            at: check.at,
                            observation: check.observation,
                            taskId: check.event.taskId,
                          })),
                        ].map((check) => {
                          // A count that differs from the newest says which check ran fewer or more tests.
                          const gaps = check.observation
                            ? [
                                check.observation.coverage.checked !==
                                observation.coverage.checked
                                  ? report("timeline.checkSummary", {
                                      checked:
                                        check.observation.coverage.checked,
                                    })
                                  : null,
                                ...gapsOf(check.observation.coverage),
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : "";
                          return (
                            <p key={check.id}>
                              <SeoDate
                                report
                                day
                                value={check.at}
                                timeZone="UTC"
                              />
                              {gaps ? ` · ${gaps}` : ""}
                              {check.taskId ? (
                                <>
                                  {" · "}
                                  {taskLink(check.taskId, true)}
                                </>
                              ) : null}
                            </p>
                          );
                        })
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap break-words">
                            {event.detail}
                          </p>
                          {event.taskId ? taskLink(event.taskId) : null}
                        </>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
