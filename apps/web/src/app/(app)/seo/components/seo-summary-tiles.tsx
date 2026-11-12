"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { HOLDER_ITEM_HOVER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SEO_SEVERITY_MARK_CLASS, SeoDate } from "./seo-shared";
import { seoSummary } from "./seo-summary-model";

/** The part of a bar that is not the counted thing. */
const REST_MARK_CLASS = "bg-quaternary";

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
  children,
  testId,
  open,
}: {
  label: string;
  value: string;
  /** The total the value is a part of, or its unit. */
  rest?: string;
  bar?: ReactNode;
  children?: ReactNode;
  testId: string;
  /** The tile leads to the list behind its number: the whole tile is the press target, with an arrow at its end. */
  open?: { label: string; onOpen: () => void };
}) {
  return (
    <div
      className={cn(
        "bg-background min-w-0 space-y-1 rounded-lg border p-2.5 sm:space-y-1.5 sm:p-3",
        open && cn("relative", HOLDER_ITEM_HOVER_CLASS),
      )}
    >
      <dt className="text-muted-foreground flex items-start justify-between gap-2 text-xs">
        {label}
        {open ? (
          <button
            type="button"
            aria-label={open.label}
            className="focus-visible:after:ring-ring cursor-pointer outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2"
            onClick={open.onOpen}
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        ) : null}
      </dt>
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
        {bar}
        {children ? (
          <div className="text-muted-foreground text-xs">{children}</div>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Two numbers with their parts. The Health tab shows the page check (issues, tests); the Agent tab shows
 * the rankings (keywords found, searches). No number shows on both tabs, so a pair fits one phone row.
 */
export function SeoSummaryTiles({
  workspace,
  onOpenRankings,
  show,
}: {
  workspace: ProjectSeoWorkspace;
  show: "health" | "rankings";
  /** Opens the Rankings tab; absent where the reader is on it. */
  onOpenRankings?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const summary = seoSummary(workspace);
  const issues = show === "health" ? summary.issues : null;
  const tests = show === "health" ? summary.tests : null;
  const keywords = show === "rankings" ? summary.keywords : null;
  const searches = show === "rankings" ? summary.searches : null;
  if (!issues && !tests && !keywords && !searches) return null;
  return (
    <dl className="grid grid-cols-2 gap-2" data-testid="seo-summary-tiles">
      {issues ? (
        <Tile
          label={t("summary.issues")}
          value={format.number(issues.total)}
          testId="seo-summary-issues"
        >
          {/* No bar: the two counts under the number and the rows under the tile already show the split. */}
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
          open={
            onOpenRankings
              ? { label: t("agent.openRankings"), onOpen: onOpenRankings }
              : undefined
          }
          // No keyword found: an all-grey bar reads as a bar that still loads.
          bar={
            keywords.found ? (
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
            ) : undefined
          }
        >
          <span className="flex flex-wrap gap-x-3">
            {keywords.found ? (
              <span>
                {t("keywords.firstPage", { count: keywords.firstPage })}
              </span>
            ) : null}
            {/* "0 of 16" is no "not in Google": the count holds for the results the check read. A depth exists only with a keyword that was not found. */}
            {keywords.depth ? (
              <span>
                {t("summary.depth", {
                  ...keywords.depth,
                  same:
                    keywords.depth.min === keywords.depth.max ? "yes" : "no",
                })}
              </span>
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
        >
          {/* All checked keywords have a number: the tile beside this one says how many they are. */}
          {searches.keywords === searches.of
            ? null
            : t("summary.searchesFor", {
                keywords: searches.keywords,
                of: searches.of,
              })}
        </Tile>
      ) : null}
      {tests ? (
        <Tile
          label={t("summary.tests")}
          value={format.number(tests.decided)}
          rest={t("summary.of", { total: format.number(tests.total) })}
          testId="seo-summary-tests"
        >
          {/* No bar: a nearly full bar reads as a health score, and this is a count of tests that ran. */}
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
            {/* The issues can come from older checks too; the tests are of this one. */}
            <span>
              {t("agent.lastCheckOn")}{" "}
              {/* The date moves to the next line as one piece: a year alone on a line reads as a value. */}
              <span className="whitespace-nowrap">
                <SeoDate day value={tests.observedAt} />
              </span>
            </span>
          </span>
        </Tile>
      ) : null}
    </dl>
  );
}
