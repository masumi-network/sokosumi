"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  measureValue,
  pageDetailGuidance,
  pageDetailGuidanceRows,
  pageDetailReferences,
  seoOverviewModel,
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

// The page check names raw-HTML rows "Raw HTML: <rule>"; the check's record already says so.
const RAW_HTML_PREFIX = "Raw HTML: ";

function checkName(title: string) {
  return title.startsWith(RAW_HTML_PREFIX)
    ? title.slice(RAW_HTML_PREFIX.length)
    : title;
}

type Diagnostic = ReturnType<typeof seoOverviewModel>["diagnostics"][number];

/** A note value longer than this (a whole keywords tag) starts folded to three lines. */
const NOTE_VALUE_FOLD_CHARS = 120;

/** One measured value or note: its name, the page when that tells rows apart, its value and the check's guidance. */
function PageDetail({
  finding,
  data,
  dated,
  showGuidance,
  onAsk,
}: {
  finding: Diagnostic;
  data: SeoWorkspaceModel["data"];
  /** Rows from several checks keep their own date and record. */
  dated: boolean;
  /** The same rule on several pages carries the same guidance; the first row shows it. */
  showGuidance: boolean;
  /** Opens the agent chat with a question about this note; absent without a chat. */
  onAsk?: (question: string) => void;
}) {
  const t = useTranslations("App.Seo");
  const headingId = useId();
  const valueId = useId();
  const pageLabelId = useId();
  const [fullValue, setFullValue] = useState(false);
  const name = checkName(finding.title);
  const first = finding.evidence[0];
  const measure = finding.severity === "measure";
  const guidance = showGuidance ? pageDetailGuidance(finding.evidence) : [];
  const foldable =
    !measure && first !== undefined && first.length > NOTE_VALUE_FOLD_CHARS;
  // With one page there is nothing to tell apart, unless the row is for a page removed since.
  const showPage =
    data.pages.length > 1 || finding.pageUrl !== data.pages[0]?.url;
  const ask = measure ? undefined : onAsk;
  return (
    <li className="space-y-1">
      {measure ? (
        // A measurement is one line; its value drops the words its name already says.
        <p className="text-sm break-words">
          <span className="font-medium">{name}:</span>{" "}
          <span className="text-muted-foreground">
            {first ? measureValue(name, first) : t("none")}
          </span>
        </p>
      ) : (
        <>
          {/* A note's name is the rule it checks, e.g. "No meta keywords", not what the page has. */}
          <h4 id={headingId} className="text-sm font-medium">
            {t("overview.noteRule", { name })}
          </h4>
          {first ? (
            <p
              id={valueId}
              className={cn(
                "text-muted-foreground text-sm break-words",
                foldable && !fullValue && "line-clamp-3",
              )}
            >
              {first}
            </p>
          ) : null}
        </>
      )}
      {/* The check's own guidance: Google's rule, then what tools use. */}
      {guidance.length ? (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {guidance.map((line, index) => (
            <li key={`${index}:${line}`} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {foldable || ask || showPage ? (
        // One row keeps the controls apart and the page link off the buttons.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {foldable ? (
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
              // Every note has this button; its heading and page tell them apart.
              aria-describedby={
                showPage ? `${headingId} ${pageLabelId}` : headingId
              }
              onClick={() =>
                ask(
                  showPage
                    ? t("overview.askAboutNoteOnPage", {
                        name,
                        url: finding.pageUrl,
                      })
                    : t("overview.askAboutNote", { name }),
                )
              }
            >
              {t("overview.askAgent")}
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
  // A question about a note goes to the agent's chat as a draft; the owner sends it.
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
            {flagged ? (
              <span className="text-muted-foreground text-sm whitespace-nowrap">
                {" "}
                · {t("overview.noteCount", { count: flagged })}
              </span>
            ) : null}
          </summary>
          <div className={cn(HOLDER_ITEM_CLASS, "mt-2 space-y-4 p-4")}>
            {oneCheck ? (
              <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span>
                  {t.rich("overview.fromCheck", {
                    date: () => <SeoDate value={oneCheckAt} />,
                  })}
                </span>
                <SeoSource
                  observationId={oneCheck.observationId}
                  workspace={data}
                />
              </div>
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
                      onAsk={askAgent}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {/* Rows show their value and guidance; provenance folds once. */}
            {references.length ? (
              <details className="text-muted-foreground text-sm">
                <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-2.5 focus-visible:ring-2 focus-visible:outline-none">
                  {t("overview.references", { count: references.length })}
                </summary>
                <ul className="list-inside list-disc space-y-1 pt-1">
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
      ) : null}
    </div>
  );
}
