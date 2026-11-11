"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SeoIssueSeverity } from "./seo-overview-model";
import { SeoDate } from "./seo-shared";
import { seoSummary } from "./seo-summary-model";

/** One fixed mark per severity; the label beside it carries the name. */
const SEVERITY_MARK_CLASS: Record<SeoIssueSeverity, string> = {
  critical: "bg-chart-2",
  major: "bg-foreground",
  minor: "bg-chart-5",
};
/** The part of a bar that is not the counted thing. */
const REST_MARK_CLASS = "bg-muted-foreground/25";

type Part = { key: string; count: number; className: string };

/** Parts of one total as one thin bar. Every part has its count in the text beside the bar. */
function Bar({ parts }: { parts: Part[] }) {
  const shown = parts.filter((part) => part.count > 0);
  return shown.length ? (
    <span aria-hidden className="flex h-1.5 gap-0.5">
      {shown.map((part) => (
        <span
          key={part.key}
          className={cn("min-w-1 rounded-full", part.className)}
          style={{ flexGrow: part.count, flexBasis: 0 }}
        />
      ))}
    </span>
  ) : null;
}

function Tile({
  label,
  value,
  rest,
  bar,
  note,
  children,
  testId,
}: {
  label: string;
  value: string;
  /** The total the value is a part of, or its unit. */
  rest?: string;
  bar?: ReactNode;
  /** A line every width shows. The bar and the parts show from the `sm` width up. */
  note?: ReactNode;
  children?: ReactNode;
  testId: string;
}) {
  return (
    <div className="min-w-0 space-y-1 rounded-md border p-2.5 sm:space-y-1.5 sm:p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="flex flex-col gap-1.5" data-testid={testId}>
        <p className="text-xl leading-tight font-semibold tabular-nums sm:text-2xl">
          {value}
          {rest ? (
            // The space is outside the unit: in a narrow tile the unit moves to the next line as one piece.
            <>
              {" "}
              <span className="text-muted-foreground text-sm font-normal whitespace-nowrap">
                {rest}
              </span>
            </>
          ) : null}
        </p>
        {/* A phone shows the number alone: four tiles with bars and parts fill its first screen. */}
        {bar ? <div className="hidden sm:block">{bar}</div> : null}
        {children ? (
          <div className="text-muted-foreground hidden text-xs sm:block">
            {children}
          </div>
        ) : null}
        {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
      </dd>
    </div>
  );
}

/**
 * The last check and the newest position reads as numbers with their parts.
 * The same row leads the Agent tab and the Health tab, so one result reads the same on both.
 */
export function SeoSummaryTiles({
  workspace,
  onOpenRankings,
  dated,
}: {
  workspace: ProjectSeoWorkspace;
  /** Dates the tests tile where no line near the row names the last check. The issues can come from older checks too. */
  dated?: boolean;
  /** Opens the Rankings tab; absent where the reader is on it. */
  onOpenRankings?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const { issues, tests, keywords, searches } = seoSummary(workspace);
  if (!issues && !tests && !keywords && !searches) return null;
  return (
    <dl
      className="grid grid-cols-2 gap-2 lg:grid-cols-4"
      data-testid="seo-summary-tiles"
    >
      {issues ? (
        <Tile
          label={t("summary.issues")}
          value={format.number(issues.total)}
          testId="seo-summary-issues"
          bar={
            <Bar
              parts={issues.parts.map((part) => ({
                key: part.severity,
                count: part.count,
                className: SEVERITY_MARK_CLASS[part.severity],
              }))}
            />
          }
        >
          {issues.parts.length ? (
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
              {issues.parts.map((part) => (
                <li
                  key={part.severity}
                  className="inline-flex items-center gap-1.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full",
                      SEVERITY_MARK_CLASS[part.severity],
                    )}
                  />
                  {t("summary.severityCount", part)}
                </li>
              ))}
            </ul>
          ) : (
            t("summary.issuesNone")
          )}
        </Tile>
      ) : null}
      {keywords ? (
        <Tile
          label={t("summary.keywords")}
          value={format.number(keywords.found)}
          rest={t("summary.of", { total: format.number(keywords.read) })}
          testId="seo-summary-keywords"
          bar={
            <Bar
              parts={[
                {
                  key: "found",
                  count: keywords.found,
                  className: "bg-foreground",
                },
                {
                  key: "rest",
                  count: keywords.read - keywords.found,
                  className: REST_MARK_CLASS,
                },
              ]}
            />
          }
        >
          <span className="flex flex-wrap gap-x-3">
            {keywords.found ? (
              <span>
                {t("keywords.firstPage", { count: keywords.firstPage })}
              </span>
            ) : null}
            {onOpenRankings ? (
              <button
                type="button"
                className="focus-visible:ring-ring -my-3 inline-block rounded-sm py-3 underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
                onClick={onOpenRankings}
              >
                {t("agent.openRankings")}
              </button>
            ) : null}
          </span>
        </Tile>
      ) : null}
      {searches ? (
        <Tile
          label={t("summary.searches")}
          value={format.number(searches.total)}
          rest={t("summary.aMonth")}
          testId="seo-summary-searches"
          // A sum for a part of the keywords says so at every width.
          note={
            searches.keywords === searches.of
              ? undefined
              : t("summary.searchesFor", {
                  keywords: searches.keywords,
                  of: searches.of,
                  same: "no",
                })
          }
        >
          {searches.keywords === searches.of
            ? t("summary.searchesFor", {
                keywords: searches.keywords,
                of: searches.of,
                same: "yes",
              })
            : null}
        </Tile>
      ) : null}
      {tests ? (
        <Tile
          label={t("summary.tests")}
          value={format.number(tests.decided)}
          rest={t("summary.of", { total: format.number(tests.total) })}
          testId="seo-summary-tests"
          note={
            dated ? (
              <>
                {t("agent.lastCheckOn")}{" "}
                <SeoDate day value={tests.observedAt} />
              </>
            ) : undefined
          }
          bar={
            <Bar
              parts={[
                {
                  key: "decided",
                  count: tests.decided,
                  className: "bg-foreground",
                },
                {
                  key: "rest",
                  count: tests.undecided + tests.unavailable,
                  className: REST_MARK_CLASS,
                },
              ]}
            />
          }
        >
          <span className="flex flex-wrap gap-x-3">
            {/* The same two counts, in the same words, as the row of the check in the Timeline. */}
            {tests.undecided ? (
              <span>
                {t("summary.testsNoResult", { count: tests.undecided })}
              </span>
            ) : null}
            {tests.unavailable ? (
              <span>
                {t("timeline.rulesUnavailable", { count: tests.unavailable })}
              </span>
            ) : null}
            {tests.undecided + tests.unavailable ? null : (
              <span>{t("summary.testsAll")}</span>
            )}
          </span>
        </Tile>
      ) : null}
    </dl>
  );
}
