"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import {
  checkName,
  seoCheckedAt,
  seoOverviewModel,
} from "./seo-overview-model";
import { SeoPages } from "./seo-pages";
import {
  SeoDate,
  SeoPageLink,
  SeoSection,
  SeoSeverity,
  SeoSource,
  seoPageLabel,
  seoPageName,
  seoSiteUrl,
} from "./seo-shared";
import { seoIssueScope } from "./seo-summary-model";
import { useSeoTileDay } from "./seo-summary-tiles";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The words that start every row of a list ("Issue:"): quiet, so the part that differs leads. */
const quietPrefix = (chunks: ReactNode) => (
  <span className="text-muted-foreground font-normal">{chunks}</span>
);

function SeoFindingList({
  data,
  findings,
}: {
  data: SeoWorkspaceModel["data"];
  findings: ReturnType<typeof seoOverviewModel>["issues"];
}) {
  const result = useSeoResultTranslations("App.Seo");
  const sameDayAsTile = useSeoTileDay(data);
  // The check's own time; its rows may carry later times per device.
  const checkedAt = (finding: Parameters<typeof seoCheckedAt>[1]) =>
    seoCheckedAt(data, finding);
  return (
    <ul
      className={cn(
        HOLDER_ITEM_CLASS,
        "stagger divide-y [--stagger-step:40ms]",
      )}
    >
      {findings.map((finding) => {
        const affectedUrl = finding.relatedPageUrl ?? finding.pageUrl;
        // A test name alone reads like a pass, so the row says it is an issue.
        return (
          <li key={finding.id}>
            <details className="group text-sm">
              <summary className="focus-visible:ring-ring grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-0.5 rounded-sm px-4 py-2.5 group-open:pb-1 focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                {/* Plain wrap, as an action title: balanced lines ended the first line at half the row. */}
                <h3 className="font-medium text-wrap break-words">
                  {/* The same words start every row: they are quiet, the name of the check is the bright part. */}
                  {result.rich("overview.failedCheck", {
                    name: checkName(finding.title),
                    prefix: quietPrefix,
                  })}
                </h3>
                {/* On a phone the impact label is the row's last line: beside the title it broke the title
                          into three lines. The open row has it under its page link there, so the lines keep the
                          order of the closed row: title, page, impact. */}
                <span className="flex max-sm:col-start-1 max-sm:row-start-3 max-sm:group-open:hidden">
                  <SeoSeverity severity={finding.severity} />
                </span>
                <ChevronDown
                  aria-hidden
                  className="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform duration-150 ease-out group-open:rotate-180 motion-reduce:transition-none"
                />
                <span className="text-muted-foreground col-span-2 text-xs [overflow-wrap:anywhere] max-sm:truncate sm:col-span-3">
                  {/* Both devices is the usual case and says nothing; one device does. */}
                  {finding.devices.length === 1
                    ? result(`analysis.${finding.devices[0]}`)
                    : null}
                  {/* The open row has the link to the page. */}
                  <span className="group-open:hidden">
                    {finding.devices.length === 1 ? " · " : null}
                    {seoPageLabel(data, affectedUrl) ??
                      seoPageName(
                        affectedUrl,
                        seoSiteUrl(data),
                        result("pages.home"),
                      )}
                  </span>
                </span>
              </summary>
              <div className="text-muted-foreground space-y-3 px-4 pb-3">
                {/* The page keeps its place under the title, as in an open action card: there it is the link. */}
                <div className="flex flex-col items-start gap-0.5">
                  <SeoPageLink
                    url={finding.pageUrl}
                    site={seoSiteUrl(data)}
                    label={seoPageLabel(data, finding.pageUrl)}
                    quiet
                  />
                  <span className="flex sm:hidden">
                    <SeoSeverity severity={finding.severity} />
                  </span>
                </div>
                {finding.relatedPageUrl ? (
                  <div className="space-y-1">
                    <p className="text-xs">
                      {result("overview.relatedFindingPage")}
                    </p>
                    <SeoPageLink url={finding.relatedPageUrl} />
                  </div>
                ) : null}
                {finding.visibility === "PRIVATE" ? (
                  <p className="text-xs">{result("overview.privateFinding")}</p>
                ) : null}
                <ul className="list-disc space-y-1 ps-4">
                  {finding.evidence.map((evidence, index) => (
                    <li key={`${index}:${evidence}`} className="break-words">
                      {evidence}
                    </li>
                  ))}
                </ul>
                {finding.suggestedFix ? (
                  <div className="space-y-1">
                    <p className="text-foreground font-medium">
                      {result("overview.suggestedFix")}
                    </p>
                    <p className="break-words">{finding.suggestedFix}</p>
                  </div>
                ) : null}
                {/* The tests tile at the top of the tab dates the last check: a finding of that day repeats no date
                          (the date of the tile opens the results of that check). An older finding has its date,
                          with a word, and the date is the link to its check. */}
                {sameDayAsTile(checkedAt(finding)) ? null : (
                  <p className="text-xs">
                    <SeoSource
                      observationId={finding.observationId}
                      workspace={data}
                    >
                      {result("overview.checkedOn")}{" "}
                      <SeoDate report value={checkedAt(finding)} day />
                    </SeoSource>
                  </p>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** Site health: what the checks found, page by page and over time. */
export function SeoHealth({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const result = useSeoResultTranslations("App.Seo");
  const { data } = model;
  const overview = seoOverviewModel(data);
  const { current, earlier } = seoIssueScope(data, overview.issues);
  const currentIds = new Set(current.map((finding) => finding.id));
  const unplanned = overview.unplanned.filter((finding) =>
    currentIds.has(finding.id),
  );
  return (
    <div className="space-y-5">
      {unplanned.length ? (
        <SeoSection title={t("overview.findings")}>
          {/* One list, one row per issue that no action fixes: the row opens its evidence. */}
          <SeoFindingList data={data} findings={unplanned} />
        </SeoSection>
      ) : null}
      {earlier.length ? (
        <SeoSection
          lang="en"
          title={result("overview.earlierFindings", { count: earlier.length })}
        >
          <SeoFindingList data={data} findings={earlier} />
        </SeoSection>
      ) : null}
      {/* The empty Actions list above says it already: only there, with no action and no strategy step. */}
      {overview.hasFailedChecks &&
      !(
        overview.emptyState === "incomplete" &&
        !overview.actions.length &&
        !data.strategy?.actions.length
      ) ? (
        <p className="text-muted-foreground px-2 text-sm">
          {result("actions.checksIncompleteBody")}
        </p>
      ) : null}
      <SeoPages model={model} />
    </div>
  );
}
