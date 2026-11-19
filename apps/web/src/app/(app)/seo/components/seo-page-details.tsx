"use client";

import { Bot, ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  actionablePageDetails,
  checkName,
  measuresOutsideToolRanges,
  measureValue,
  noteFinding,
  pageDetailGuidance,
  pageDetailGuidanceRows,
  pageDetailReferences,
  seoCheckedAt,
  seoOverviewModel,
  toolRangeFit,
  toolRangesList,
  withoutRuleCodes,
} from "./seo-overview-model";
import { SeoRankDetailRow } from "./seo-rank-detail";
import { seoRankDetail } from "./seo-rank-detail-model";
import {
  SeoDate,
  SeoFoldSummary,
  SeoPageLink,
  SeoSource,
  seoPageLabel,
  seoSiteUrl,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type Diagnostic = ReturnType<typeof seoOverviewModel>["diagnostics"][number];

/** Gold marks a counted suggestion (the newest value outside a tool range), grey a note or any other value. */
const PAGE_DETAIL_MARK = {
  suggestion: "bg-chart-3",
  note: "bg-chart-5",
  inside: "bg-chart-5",
} as const;

/** A note value longer than this (a whole keywords tag) starts folded to three lines. */
const NOTE_VALUE_FOLD_CHARS = 120;

/** With this many action rows or fewer the tab has room, so the page details start open. */
const OPEN_DETAILS_MAX_ACTIONS = 3;

/** One measured value or note: its name, the page when that tells rows apart, its value and the check's guidance. */
function PageDetail({
  finding,
  data,
  dated,
  showGuidance,
  suggested,
  offersFix,
  onAsk,
  onShowRankings,
  noteHeading: NoteHeading,
}: {
  finding: Diagnostic;
  data: SeoWorkspaceModel["data"];
  /** Rows from several checks keep their own date and record. */
  dated: boolean;
  /** The same rule on several pages carries the same guidance; the first row shows it. */
  showGuidance: boolean;
  /** A row of a measurement the Agent tab counts as a suggestion; it carries the "Suggestion:" mark. */
  suggested: boolean;
  /** The suggestion's first row offers "Draft a fix"; its other device rows do not repeat it. */
  offersFix: boolean;
  /** Opens the agent chat with this row's question or fix request as a draft; absent without a chat. */
  onAsk?: (question: string) => void;
  /** Opens the Rankings tab, where the keywords of a position row are. */
  onShowRankings: () => void;
  /** The heading tag of a note, one level under its section's heading. */
  noteHeading: "h4" | "h5";
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const headingId = useId();
  const valueId = useId();
  const pageLabelId = useId();
  const [fullValue, setFullValue] = useState(false);
  const valueRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  const name = checkName(finding.title);
  const first = finding.evidence[0];
  const measure = finding.severity === "measure";
  // The position measure is a short row of its own; its lines stay in a fold there.
  const rank = measure ? seoRankDetail(finding.evidence) : null;
  const guidance =
    showGuidance && !rank ? pageDetailGuidance(finding.evidence) : [];
  const value = measure && first ? measureValue(name, first) : undefined;
  // Each page's value gets its own fit, though only the first row shows the ranges.
  const fit = value
    ? toolRangeFit(value, pageDetailGuidance(finding.evidence))
    : null;
  // A note leads with what the check found on the page; its rule name can read as the opposite.
  // A long finding stays a foldable value under the rule, not a heading.
  const split =
    !measure && first !== undefined ? noteFinding(first) : undefined;
  const note =
    split && split.found.length <= NOTE_VALUE_FOLD_CHARS ? split : undefined;
  const detail = note ? note.detail : measure ? undefined : first;
  const foldable =
    detail !== undefined && detail.length > NOTE_VALUE_FOLD_CHARS;
  // With one page there is nothing to tell apart, unless the row is for a page removed since.
  const showPage =
    data.pages.length > 1 || finding.pageUrl !== data.pages[0]?.url;
  // The toggle shows only once the clamp cuts the text. A closed fold has no size,
  // so the check runs again when it opens.
  useLayoutEffect(() => {
    const element = valueRef.current;
    // New text in the same box does not resize it, so the text itself starts a new check.
    if (!foldable || fullValue || !element || !detail) return;
    // Once cut, the toggle stays: dropping it on a resize would drop the focus on it.
    const check = () =>
      setClamped((cut) => cut || element.scrollHeight > element.clientHeight);
    check();
    // Without an observer the fold cannot be measured again; keep the toggle so the text can open.
    if (typeof ResizeObserver === "undefined") {
      setClamped(true);
      return;
    }
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [foldable, fullValue, detail]);
  const toggle = foldable && clamped;
  // A note can always be asked about; a measurement only when some tool range leaves it out.
  const ask = measure ? (offersFix ? onAsk : undefined) : onAsk;
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      {rank ? (
        <SeoRankDetailRow
          name={name}
          headingId={headingId}
          detail={rank}
          evidence={finding.evidence}
          onShowRankings={onShowRankings}
        />
      ) : measure ? (
        // A measurement is one line; its value drops the words its name already says.
        <p className="text-sm break-words">
          <span id={headingId} className="font-medium">
            {name}:
          </span>{" "}
          <span className="tabular-nums">{value ?? t("none")}</span>
          {fit?.outside.length ? (
            // Google sets no limit for these; the tools' ranges say whether a value stands out.
            <span
              className={cn(
                "text-muted-foreground",
                suggested && "text-foreground",
              )}
            >
              {" · "}
              {/* A counted suggestion has the color of the suggestion count on the fold's head; other values are grey. */}
              <span
                aria-hidden
                className={cn(
                  "me-1.5 inline-block size-1.5 rounded-full align-middle forced-colors:bg-[CanvasText]",
                  suggested
                    ? PAGE_DETAIL_MARK.suggestion
                    : PAGE_DETAIL_MARK.inside,
                )}
              />
              {suggested ? `${t("overview.suggestion")} ` : null}
              {t("overview.outsideToolRanges", {
                outside: fit.outside.length,
                total: fit.total,
                tools: format.list(fit.outside),
              })}
            </span>
          ) : null}
        </p>
      ) : (
        <>
          {/* The heading is the check's own finding; the rule name, e.g. "No meta keywords", follows it. */}
          <NoteHeading
            id={headingId}
            className="text-sm font-medium break-words"
          >
            {note
              ? t("overview.noteFound", { found: note.found })
              : t("overview.noteRule", { name })}
          </NoteHeading>
          {note ? (
            <p className="text-muted-foreground text-xs">
              {t("overview.noteRuleName", { name })}
            </p>
          ) : null}
          {detail ? (
            <p
              id={valueId}
              ref={valueRef}
              className={cn(
                "text-muted-foreground text-sm break-words",
                foldable && !fullValue && "line-clamp-3",
              )}
            >
              {detail}
            </p>
          ) : null}
        </>
      )}
      {/* The check's own guidance: Google's rule, then what tools use. */}
      {guidance.length ? (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {guidance.map((line, index) => (
            <li key={`${index}:${line}`} className="break-words">
              {toolRangesList(line) === undefined
                ? withoutRuleCodes(line)
                : t("overview.toolRanges", {
                    ranges: toolRangesList(line) ?? "",
                  })}
            </li>
          ))}
        </ul>
      ) : null}
      {toggle || ask || showPage ? (
        // One row keeps the controls apart and the page link off the buttons.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {toggle ? (
            <button
              type="button"
              aria-expanded={fullValue}
              aria-controls={valueId}
              aria-describedby={headingId}
              onClick={() => setFullValue((open) => !open)}
              className="focus-visible:ring-ring -my-3 rounded-sm py-3 text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              {t(fullValue ? "overview.showLess" : "overview.showAll")}
            </button>
          ) : null}
          {ask ? (
            <Button
              variant="outline"
              size="sm"
              // Many rows have this button; their name and page tell them apart.
              aria-describedby={
                showPage ? `${headingId} ${pageLabelId}` : headingId
              }
              onClick={() =>
                ask(
                  // The same request as the Agent tab's "Draft a fix" step.
                  measure
                    ? t("agent.prompts.measure", {
                        name,
                        value: value ?? "",
                        tools: format.list(fit?.outside ?? []),
                        count: fit?.outside.length ?? 0,
                        url: finding.pageUrl,
                      })
                    : showPage
                      ? t("overview.askAboutNoteOnPage", {
                          name,
                          url: finding.pageUrl,
                        })
                      : t("overview.askAboutNote", { name }),
                )
              }
            >
              <Bot />
              {t(measure ? "agent.draftFix" : "overview.askAgent")}
            </Button>
          ) : null}
          {showPage ? (
            <>
              <span id={pageLabelId} className="sr-only">
                {finding.pageUrl}
              </span>
              <SeoPageLink
                url={finding.pageUrl}
                site={seoSiteUrl(data)}
                label={seoPageLabel(data, finding.pageUrl)}
              />
            </>
          ) : null}
        </div>
      ) : null}
      {dated ? (
        // The date is the link to the check; its hit area grows down, off the page link over it.
        <div className="text-muted-foreground flex flex-wrap gap-3 pt-2 text-xs">
          <SeoSource observationId={finding.observationId} workspace={data}>
            <SeoDate value={finding.observedAt} />
          </SeoSource>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Title, description and other page details: the measured values and notes of the checks, folded under the
 * action rows of the Actions list. Its head has the shape of an action row: a rail, the name and its counts.
 * Without that list (only strategy actions) it stands in a card of its own, and its headings move up a level.
 */
export function SeoPageDetails({
  model,
  standalone = false,
}: {
  model: SeoWorkspaceModel;
  standalone?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const { data } = model;
  const overview = seoOverviewModel(data);
  // Set on the first render with rows, then kept: a new check that adds actions does not close a fold the reader
  // has open. A workspace without a check yet has no rows, so its first check still decides.
  const [startOpen, setStartOpen] = useState<boolean | null>(null);
  // The details of a day of the runs row carry each check's coverage; only checks without a row there are listed here.
  const onTimeline = new Set(data.timeline.map((event) => event.observationId));
  const offTimeline = data.observations.filter(
    (observation) => !onTimeline.has(observation.id),
  );
  // A value inside every tool range asks nothing, so it is left out.
  const diagnostics = actionablePageDetails(overview.diagnostics);
  if (!diagnostics.length && !offTimeline.length) return null;
  if (startOpen === null)
    setStartOpen(overview.actions.length <= OPEN_DETAILS_MAX_ACTIONS);
  // Rows from one check share its date and record; say them once above the rows.
  const oneCheck =
    !offTimeline.length &&
    new Set(diagnostics.map((finding) => finding.observationId)).size === 1
      ? diagnostics[0]
      : undefined;
  const oneCheckAt = oneCheck ? seoCheckedAt(data, oneCheck) : null;
  // Measurements report a value; notes are rules the check flagged that do not count as issues.
  const measures = diagnostics.filter(
    (finding) => finding.severity === "measure",
  );
  const notes = diagnostics.filter((finding) => finding.severity !== "measure");
  const flagged = notes.length;
  // The Agent tab's suggestions: the newest check's values outside a tool range.
  const suggestionList = measuresOutsideToolRanges(overview.diagnostics);
  const suggestions = suggestionList.length;
  const suggestedRows = new Set(
    suggestionList.flatMap((suggestion) => suggestion.findingIds),
  );
  // One fix per suggestion: its first row carries the button, so devices do not repeat it.
  const fixRows = new Set(
    suggestionList.map((suggestion) => suggestion.findingIds[0]),
  );
  const references = pageDetailReferences(
    diagnostics.map((finding) => ({
      name: checkName(finding.title),
      evidence: finding.evidence,
    })),
  );
  // A position row shows its lines in its own fold, so it shows no guidance of its own.
  const guidanceRows = pageDetailGuidanceRows(
    diagnostics
      .filter((finding) => !seoRankDetail(finding.evidence))
      .map((finding) => ({
        id: finding.id,
        name: checkName(finding.title),
        evidence: finding.evidence,
      })),
  );
  // A question or fix request goes to the agent's chat as a draft; the owner sends it.
  const showRankings = () => void model.setFilters({ tab: "rankings" });
  const askAgent = data.auditId
    ? (question: string) => model.openChat(question)
    : undefined;
  const counted = suggestions > 0 || flagged > 0;
  const Heading = standalone ? "h2" : "h3";
  const SectionHeading = standalone ? "h3" : "h4";
  const noteHeading = standalone ? "h4" : "h5";
  const fold = (
    <details
      open={startOpen ?? false}
      className={cn(HOLDER_ITEM_CLASS, "group/details text-sm")}
    >
      {/* The same shape as an action row: the rail, the name, its counts as marks, and the arrow at the end. */}
      {/* A grid, not wrappers: a summary holds phrasing content and a heading, so the heading is its own child. */}
      {/* Without counts the grid has no counts column and no second row of counts on a phone. */}
      {/* The line under the name says what the fold holds: on a phone it is the last row, under the counts. */}
      <summary
        className={cn(
          "focus-visible:ring-ring grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-[calc(var(--radius-lg)-1px)] px-3 py-2.5 hover:bg-accent focus-visible:ring-2 group-open/details:rounded-b-none focus-visible:outline-none [&::-webkit-details-marker]:hidden",
          counted && "sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "row-span-2 row-start-1 w-1 self-stretch rounded-full forced-colors:bg-[CanvasText]",
            counted && "max-sm:row-span-3",
            suggestions ? PAGE_DETAIL_MARK.suggestion : "bg-border",
          )}
        />
        <Heading className="col-start-2 row-start-1 min-w-0 text-sm font-semibold break-words">
          {t("overview.diagnostics")}
        </Heading>
        {counted ? (
          // On a phone the counts are a line of their own under the name.
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs max-sm:col-start-2 max-sm:row-start-2 sm:col-start-3 sm:row-start-1">
            {suggestions ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full forced-colors:bg-[CanvasText]",
                    PAGE_DETAIL_MARK.suggestion,
                  )}
                />
                {t("overview.suggestionCount", { count: suggestions })}
              </span>
            ) : null}
            {/* The marks part the counts on screen; a screen reader hears a comma. */}
            {suggestions && flagged ? (
              <span className="sr-only">, </span>
            ) : null}
            {flagged ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full forced-colors:bg-[CanvasText]",
                    PAGE_DETAIL_MARK.note,
                  )}
                />
                {t("overview.noteCount", { count: flagged })}
              </span>
            ) : null}
          </span>
        ) : null}
        {/* After the counts, as on a phone, where it is the last row. */}
        <span
          className={cn(
            "text-muted-foreground col-start-2 min-w-0 text-xs break-words",
            counted
              ? "max-sm:row-start-3 sm:col-[2/4] sm:row-start-2"
              : "row-start-2",
          )}
        >
          {t("overview.diagnosticsHelp")}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "text-muted-foreground col-start-3 row-start-1 size-4 shrink-0 transition-transform duration-150 ease-out group-open/details:rotate-180 motion-reduce:transition-none",
            counted && "sm:col-start-4",
          )}
        />
      </summary>
      <div className="border-border space-y-5 border-t p-4">
        {oneCheck ? (
          // The date of the tests tile, the check's row in the details of its day or its page card links its results.
          <p className="text-muted-foreground text-xs">
            {t.rich("overview.fromCheck", {
              date: () => <SeoDate value={oneCheckAt} />,
            })}
          </p>
        ) : null}
        {offTimeline.map((observation) => (
          <div key={observation.id} className="text-muted-foreground space-y-2">
            <p>
              {t("overview.coverageCounts", {
                checked: observation.coverage.checked,
                skipped: observation.coverage.skipped,
                failed: observation.coverage.failed,
              })}
            </p>
            {observation.coverage.modules ? (
              <p>
                {t("overview.moduleCoverage", {
                  notRequested: observation.coverage.modules.notRequested,
                  failed: observation.coverage.modules.failed,
                })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3 text-xs">
              <SeoSource observationId={observation.id} workspace={data}>
                <SeoDate value={observation.observedAt} />
              </SeoSource>
            </div>
          </div>
        ))}
        {measures.length ? (
          <section className="space-y-2">
            <SectionHeading className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t("overview.pageMeasurements")}
            </SectionHeading>
            <ul className="divide-border divide-y">
              {measures.map((finding) => (
                <PageDetail
                  key={finding.id}
                  finding={finding}
                  data={data}
                  dated={!oneCheck}
                  showGuidance={guidanceRows.has(finding.id)}
                  suggested={suggestedRows.has(finding.id)}
                  offersFix={fixRows.has(finding.id)}
                  onAsk={askAgent}
                  onShowRankings={showRankings}
                  noteHeading={noteHeading}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {notes.length ? (
          <section className="space-y-2">
            {/* Notes do not count toward the verdict; the summary counts them apart from suggestions. */}
            <SectionHeading className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t("overview.pageNotes", { count: notes.length })}
            </SectionHeading>
            <ul className="divide-border divide-y">
              {notes.map((finding) => (
                <PageDetail
                  key={finding.id}
                  finding={finding}
                  data={data}
                  dated={!oneCheck}
                  showGuidance={guidanceRows.has(finding.id)}
                  suggested={false}
                  offersFix={false}
                  onAsk={askAgent}
                  onShowRankings={showRankings}
                  noteHeading={noteHeading}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {/* Rows show their value and guidance; provenance folds once. */}
        {references.length ? (
          <details className="text-muted-foreground border-border border-t pt-2 text-sm">
            <SeoFoldSummary className="py-2.5">
              {t("overview.references", { count: references.length })}
            </SeoFoldSummary>
            <ul className="list-disc space-y-1 ps-4 pt-1">
              {references.map((reference) => (
                <li key={reference.line} className="break-words">
                  {reference.names.length
                    ? `${reference.names.join(", ")}: ${reference.line}`
                    : reference.line}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </details>
  );
  return standalone ? (
    <section className={cn(HOLDER_CLASS, "min-w-0")}>{fold}</section>
  ) : (
    fold
  );
}
