"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { HOLDER_ITEM_HOVER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SEO_SEVERITY_MARK_CLASS, SeoDate, SeoSource } from "./seo-shared";
import { seoSummary } from "./seo-summary-model";

/**
 * Says if a time is of the day the tests tile shows. A row under the tile repeats no date of that day.
 * The day is the text of a date line, so two checks compare the way their dates read.
 */
export function useSeoTileDay(workspace: ProjectSeoWorkspace) {
  const format = useFormatter();
  const day = (value: Date | string | null | undefined) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium" }) : null;
  const tile = day(seoSummary(workspace).tests?.observedAt);
  return (value: Date | string | null | undefined) => day(value) === tile;
}

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
  restHint,
  quiet,
  bar,
  children,
  testId,
  open,
}: {
  label: string;
  value: string;
  /** The total the value is a part of, or its unit. */
  rest?: string;
  /** What the rest of the total is, as the hint of a pointer. */
  restHint?: string;
  /** A count the reader does not act on: its number is quiet, so the number of the tile beside it leads. */
  quiet?: boolean;
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
            className="focus-visible:after:ring-ring cursor-pointer outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 max-sm:absolute max-sm:inset-0"
            onClick={open.onOpen}
          >
            {/* On a phone the arrow stands on the number line: in a column beside the label it wraps the label
                to a third line, and the two tiles of a row then hold their numbers at two heights. The button has
                no content there, so it takes the box of the tile: a screen reader needs a box to point at. */}
            <ChevronRight aria-hidden className="size-4 max-sm:hidden" />
          </button>
        ) : null}
      </dt>
      <dd className="flex flex-col gap-1.5" data-testid={testId}>
        <div className="flex items-center justify-between gap-2">
          <p
            className={cn(
              // One size on every width: larger, the numbers outranked the headline of the Agent tab.
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
          {open ? (
            <ChevronRight
              aria-hidden
              className="text-muted-foreground size-4 shrink-0 sm:hidden"
            />
          ) : null}
        </div>
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
          // The line under the number says the split only when two kinds are outside the count.
          restHint={
            tests.undecided && !tests.unavailable
              ? t("summary.testsNoResult", { count: tests.undecided })
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
            {/* The issues can come from older checks too; the tests are of this one. The date opens its results:
                a page row of this check, under the tile, repeats no link to them. */}
            <span>
              {t("agent.lastCheckOn")}{" "}
              {/* The date alone is the link: a link that broke into two underlined lines read as two links.
                  It moves to the next line as one piece: a year alone on a line reads as a value. */}
              <span className="whitespace-nowrap">
                <SeoSource
                  observationId={tests.observationId}
                  workspace={workspace}
                >
                  <SeoDate day value={tests.observedAt} />
                </SeoSource>
              </span>
            </span>
          </span>
        </Tile>
      ) : null}
    </dl>
  );
}
