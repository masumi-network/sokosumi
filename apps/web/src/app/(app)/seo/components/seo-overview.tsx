"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  checkName,
  measuresOutsideToolRanges,
  measureValue,
  noteFinding,
  pageDetailGuidance,
  pageDetailGuidanceRows,
  pageDetailReferences,
  pageDetailRuleCodes,
  seoOverviewModel,
  toolRangeFit,
  toolRangesList,
  withoutRuleCodes,
} from "./seo-overview-model";
import { SeoPages } from "./seo-pages";
import {
  SeoDate,
  SeoPageLink,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import { SeoTimeline } from "./seo-timeline";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type Diagnostic = ReturnType<typeof seoOverviewModel>["diagnostics"][number];

/** A note value longer than this (a whole keywords tag) starts folded to three lines. */
const NOTE_VALUE_FOLD_CHARS = 120;

/** One measured value or note: its name, the page when that tells rows apart, its value and the check's guidance. */
function PageDetail({
  finding,
  data,
  dated,
  showGuidance,
  suggested,
  offersFix,
  onAsk,
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
  const guidance = showGuidance ? pageDetailGuidance(finding.evidence) : [];
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
    <li className="space-y-1">
      {measure ? (
        // A measurement is one line; its value drops the words its name already says.
        <p className="text-sm break-words">
          <span id={headingId} className="font-medium">
            {name}:
          </span>{" "}
          <span className="text-muted-foreground">{value ?? t("none")}</span>
          {fit ? (
            // Google sets no limit for these; the tools' ranges say whether a value stands out.
            <span>
              {" · "}
              {suggested ? `${t("overview.suggestion")} ` : null}
              {fit.outside.length
                ? t("overview.outsideToolRanges", {
                    outside: fit.outside.length,
                    total: fit.total,
                    tools: format.list(fit.outside),
                  })
                : t("overview.insideToolRanges", { total: fit.total })}
            </span>
          ) : null}
        </p>
      ) : (
        <>
          {/* The heading is the check's own finding; the rule name, e.g. "No meta keywords", follows it. */}
          <h4 id={headingId} className="text-sm font-medium break-words">
            {note
              ? t("overview.noteFound", { found: note.found })
              : t("overview.noteRule", { name })}
          </h4>
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
              {t(measure ? "agent.draftFix" : "overview.askAgent")}
            </Button>
          ) : null}
          {showPage ? (
            <>
              <span id={pageLabelId} className="sr-only">
                {finding.pageUrl}
              </span>
              <SeoPageLink url={finding.pageUrl} />
            </>
          ) : null}
        </div>
      ) : null}
      {dated ? (
        // The record link's hit area reaches up; the gap keeps it off the page link.
        <div className="text-muted-foreground flex flex-wrap gap-3 pt-2 text-xs">
          <SeoDate value={finding.observedAt} />
          <SeoSource observationId={finding.observationId} workspace={data} />
        </div>
      ) : null}
    </li>
  );
}

/** Site health: run a check, then what the checks found, page by page and over time. */
export function SeoHealth({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const { data } = model;
  const overview = seoOverviewModel(data);
  // Timeline rows carry their own check's coverage; only checks without a row are listed here.
  const onTimeline = new Set(data.timeline.map((event) => event.observationId));
  const offTimeline = data.observations.filter(
    (observation) => !onTimeline.has(observation.id),
  );
  // Rows from one check share its date and record; say them once above the rows.
  const oneCheck =
    !offTimeline.length &&
    new Set(overview.diagnostics.map((finding) => finding.observationId))
      .size === 1
      ? overview.diagnostics[0]
      : undefined;
  // The check's own time; its rows may carry later times per device.
  const oneCheckAt = oneCheck
    ? (data.observations.find(
        (observation) => observation.id === oneCheck.observationId,
      )?.observedAt ?? oneCheck.observedAt)
    : null;
  // Measurements report a value; notes are rules the check flagged that do not count as issues.
  const measures = overview.diagnostics.filter(
    (finding) => finding.severity === "measure",
  );
  const notes = overview.diagnostics.filter(
    (finding) => finding.severity !== "measure",
  );
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
    overview.diagnostics.map((finding) => ({
      name: checkName(finding.title),
      evidence: finding.evidence,
    })),
  );
  const guidanceRows = pageDetailGuidanceRows(
    overview.diagnostics.map((finding) => ({
      id: finding.id,
      name: checkName(finding.title),
      evidence: finding.evidence,
    })),
  );
  // Rule IDs leave the shown guidance and fold with the sources.
  const ruleCodes = pageDetailRuleCodes(
    overview.diagnostics
      .filter((finding) => guidanceRows.has(finding.id))
      .flatMap((finding) => pageDetailGuidance(finding.evidence)),
  );
  // A question or fix request goes to the agent's chat as a draft; the owner sends it.
  const askAgent = data.auditId
    ? (question: string) => model.openChat(question)
    : undefined;
  return (
    <div className="space-y-5">
      {overview.issues.length ? (
        <SeoSection title={t("overview.findings")}>
          {overview.issues.map((finding) => (
            <article
              key={finding.id}
              className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}
            >
              <div className="flex flex-wrap items-start gap-2">
                <SeoState>{t(`severity.${finding.severity}`)}</SeoState>
                <h3 className="text-sm font-medium">{finding.title}</h3>
              </div>
              <SeoPageLink url={finding.pageUrl} />
              <details className="text-muted-foreground text-sm">
                <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-2.5 focus-visible:ring-2 focus-visible:outline-none">
                  {t("overview.checkDetails")}
                </summary>
                <ul className="list-inside list-disc space-y-1 pt-3">
                  {finding.evidence.map((evidence, index) => (
                    <li key={`${index}:${evidence}`} className="break-words">
                      {evidence}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-3 pt-3 text-xs">
                  <SeoDate value={finding.observedAt} />
                  <SeoSource
                    observationId={finding.observationId}
                    workspace={data}
                  />
                </div>
              </details>
            </article>
          ))}
        </SeoSection>
      ) : null}
      {overview.hasFailedChecks && overview.emptyState !== "incomplete" ? (
        <p className="text-muted-foreground px-2 text-sm">
          {t("actions.checksIncompleteBody")}
        </p>
      ) : null}
      {overview.recentChecks.length ? (
        <SeoSection title={t("overview.recentChecks")}>
          {overview.recentChecks.map((item) => (
            <div
              key={item.id}
              className={cn(
                HOLDER_ITEM_CLASS,
                "flex flex-wrap items-center justify-between gap-3 p-4",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {t(`analysis.${item.kind}`)}
                </span>
                <SeoState>{t(`analysis.${item.status}`)}</SeoState>
              </div>
              {item.taskId ? (
                <Link
                  href={`/tasks/${encodeURIComponent(item.taskId)}`}
                  className="text-sm underline underline-offset-4"
                >
                  {t("openTask")}
                </Link>
              ) : null}
            </div>
          ))}
        </SeoSection>
      ) : null}
      <SeoTimeline
        workspace={data}
        // Like Sync now and Add a page: the card's own action sits in its header.
        actions={
          data.availableActions.canRequestAnalysis ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!data.scope.pageIds.length}
              onClick={() => model.setDialog("analysis")}
            >
              <Play className="size-4" />
              {t("runAnalysis")}
            </Button>
          ) : undefined
        }
        onRetry={
          data.availableActions.canRequestAnalysis
            ? () => model.setDialog("analysis")
            : undefined
        }
      />
      <SeoPages model={model} />
      {overview.diagnostics.length || offTimeline.length ? (
        <details className={cn(HOLDER_CLASS, "text-sm")}>
          <summary className="focus-visible:ring-ring cursor-pointer rounded-sm px-2 py-2.5 focus-visible:ring-2 focus-visible:outline-none">
            <h2 className="inline text-sm font-semibold">
              {t("overview.diagnostics")}
            </h2>
            {suggestions ? (
              <span className="text-muted-foreground text-sm whitespace-nowrap">
                {" "}
                · {t("overview.suggestionCount", { count: suggestions })}
              </span>
            ) : null}
            {flagged ? (
              <span className="text-muted-foreground text-sm whitespace-nowrap">
                {" "}
                · {t("overview.noteCount", { count: flagged })}
              </span>
            ) : null}
          </summary>
          <div className={cn(HOLDER_ITEM_CLASS, "mt-2 space-y-4 p-4")}>
            {oneCheck ? (
              // The Timeline row for this check links its results; the date says which row it is.
              <p className="text-muted-foreground text-xs">
                {t.rich("overview.fromCheck", {
                  date: () => <SeoDate value={oneCheckAt} />,
                })}
              </p>
            ) : null}
            {offTimeline.map((observation) => (
              <div
                key={observation.id}
                className="text-muted-foreground space-y-2"
              >
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
                  <SeoDate value={observation.observedAt} />
                  <SeoSource observationId={observation.id} workspace={data} />
                </div>
              </div>
            ))}
            {measures.length ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {t("overview.pageMeasurements")}
                </h3>
                <ul className="space-y-3">
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
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {notes.length ? (
              <section className="space-y-2">
                {/* Notes do not count toward the verdict; say so where they are listed. */}
                <h3 className="text-sm">
                  <span className="font-semibold">
                    {t("overview.pageNotes", { count: notes.length })}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {t("overview.notesNotCounted")}
                  </span>
                </h3>
                <ul className="space-y-3">
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
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {/* Rows show their value and guidance; provenance folds once. */}
            {references.length || ruleCodes.length ? (
              <details className="text-muted-foreground text-sm">
                <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-2.5 focus-visible:ring-2 focus-visible:outline-none">
                  {references.length && ruleCodes.length
                    ? t("overview.referencesAndRules")
                    : references.length
                      ? t("overview.references", { count: references.length })
                      : t("overview.rulesOnly")}
                </summary>
                <ul className="list-inside list-disc space-y-1 pt-1">
                  {references.map((reference) => (
                    <li key={reference.line} className="break-words">
                      {reference.names.length
                        ? `${reference.names.join(", ")}: ${reference.line}`
                        : reference.line}
                    </li>
                  ))}
                  {ruleCodes.length ? (
                    <li className="break-words">
                      {t("overview.ruleIds", { ids: ruleCodes.join(", ") })}
                    </li>
                  ) : null}
                </ul>
              </details>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
