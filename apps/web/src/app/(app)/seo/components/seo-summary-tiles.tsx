"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import type { ReactNode } from "react";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { seoRunsDateCheck } from "./seo-runs-model";
import { SEO_SEVERITY_MARK_CLASS, SeoDate, SeoSource } from "./seo-shared";
import { seoSummary } from "./seo-summary-model";

/**
 * Says if a time is of the day the tests tile shows. A row under the tile repeats no date of that day.
 * The day is the text of a date line, so two checks compare the way their dates read.
 */
export function useSeoTileDay(workspace: ProjectSeoWorkspace) {
  const format = useSeoResultFormatter();
  const day = (value: Date | string | null | undefined) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium" }) : null;
  const tile = day(seoSummary(workspace).tests?.observedAt);
  return (value: Date | string | null | undefined) => day(value) === tile;
}

function Tile({
  label,
  value,
  rest,
  restHint,
  quiet,
  children,
  testId,
}: {
  label: string;
  value: string;
  /** The total the value is a part of, or its unit. */
  rest?: string;
  /** What the rest of the total is, as the hint of a pointer. */
  restHint?: string;
  /** A count the reader does not act on: its number is quiet, so the number of the tile beside it leads. */
  quiet?: boolean;
  children?: ReactNode;
  testId: string;
}) {
  return (
    <div className="bg-background min-w-0 space-y-1 rounded-lg border p-2.5 sm:space-y-1.5 sm:p-3">
      <dt
        lang="en"
        className="text-muted-foreground flex items-start justify-between gap-2 text-xs"
      >
        {label}
      </dt>
      <dd className="flex flex-col gap-1.5" data-testid={testId}>
        <div className="flex items-center justify-between gap-2">
          <p
            className={cn(
              // One size on every width: larger, the numbers outranked the headline of the tab.
              "min-w-0 text-xl leading-tight font-semibold tabular-nums",
              quiet && "text-muted-foreground",
            )}
          >
            {value}
            {rest ? (
              // The space is outside the unit: in a narrow tile the unit moves to the next line as one piece.
              <>
                {" "}
                <span
                  title={restHint}
                  className="text-muted-foreground text-sm font-normal whitespace-nowrap"
                >
                  {rest}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {children ? (
          <div className="text-muted-foreground text-xs">{children}</div>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * The page check as two numbers with their parts: issues and tests, on the Actions tab. The Agent tab names
 * its keyword numbers in the figures under its verdict.
 */
export function SeoSummaryTiles({
  workspace,
  filters,
}: {
  workspace: ProjectSeoWorkspace;
  /** The time the page shows: where the runs row names the day of the tests, the tile does not. */
  filters?: { from: string | null; to: string | null };
}) {
  const result = useSeoResultTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const summary = seoSummary(workspace);
  const { issues, tests } = summary;
  const testsDated = !(
    tests &&
    filters &&
    seoRunsDateCheck(workspace, filters, tests.observationId)
  );
  if (!issues && !tests) return null;
  return (
    <dl
      className="stagger grid grid-cols-2 gap-2"
      data-testid="seo-summary-tiles"
    >
      {issues ? (
        <Tile
          label={result("summary.issues")}
          value={format.number(issues.total)}
          testId="seo-summary-issues"
        >
          {/* No bar: the two counts under the number and the issue rows of the tab already show the split. */}
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
                      SEO_SEVERITY_MARK_CLASS[part.severity],
                    )}
                  />
                  {result("summary.severityCount", part)}
                </li>
              ))}
            </ul>
          ) : (
            result("summary.issuesNone")
          )}
        </Tile>
      ) : null}
      {tests ? (
        <Tile
          label={result("summary.tests")}
          value={format.number(tests.decided)}
          rest={result("summary.of", { total: format.number(tests.total) })}
          // The line under the number says the split only when two kinds are outside the count.
          restHint={
            tests.undecided && !tests.unavailable
              ? result("summary.testsNoResult", { count: tests.undecided })
              : undefined
          }
          // The issue count beside it is the message of the tab; this count asks for no action.
          quiet
          testId="seo-summary-tests"
        >
          {/* No bar: a nearly full bar reads as a health score, and this is a count of tests that ran. */}
          <span className="flex flex-wrap gap-x-3">
            {/* Tests without a result are the usual case (a page has no such element): alone, "201 of 231"
                says their count already. A test that could not run is a fault and always shows. With both, the
                split is news: the same two counts, in the same words, as the row of the check in the Timeline. */}
            {tests.undecided && tests.unavailable ? (
              <span>
                {result("summary.testsNoResult", { count: tests.undecided })}
              </span>
            ) : null}
            {tests.unavailable ? (
              <span>
                {result("timeline.rulesUnavailable", {
                  count: tests.unavailable,
                })}
              </span>
            ) : null}
            {tests.undecided + tests.unavailable ? null : (
              <span>{result("summary.testsAll")}</span>
            )}
            {/* The issues can come from older checks too; the tests are of this one. The date opens its results:
                a page row of this check, under the tile, repeats no link to them. Where the runs row over the
                tabs names the day, the link names the results alone. */}
            {testsDated ? (
              <span>
                {result("agent.lastCheckOn")}{" "}
                {/* The date alone is the link: a link that broke into two underlined lines read as two links.
                    It moves to the next line as one piece: a year alone on a line reads as a value. */}
                <span className="whitespace-nowrap">
                  <SeoSource
                    observationId={tests.observationId}
                    workspace={workspace}
                  >
                    <SeoDate report day value={tests.observedAt} />
                  </SeoSource>
                </span>
              </span>
            ) : (
              // "View results": the link says where it leads. A check without results to open shows nothing.
              <SeoSource
                observationId={tests.observationId}
                workspace={workspace}
              />
            )}
          </span>
        </Tile>
      ) : null}
    </dl>
  );
}
