"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useId } from "react";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { SeoAuditDiscovery } from "./seo-audit-discovery";
import { SeoPropertyPageDiscovery } from "./seo-property-page-discovery";
import {
  auditMetrics,
  SeoPropertyPerformance,
  useAuditMetricFormat,
} from "./seo-property-performance";
import { SeoFoldSummary, SeoPageLink } from "./seo-shared";

type Evidence = NonNullable<ProjectSeoWorkspace["auditSearchConsole"]>[number];
export function SeoAuditSearchConsole({ evidence }: { evidence: Evidence }) {
  const report = useSeoResultTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const heading = useId();
  const recommendations = useId();
  const { period, number } = useAuditMetricFormat();
  const { previous, queries, propertyTotals } = evidence;
  const topClickedPages = evidence.pageDiscovery?.topClickedPages;
  const unverified =
    evidence.measuredPages.length > 0 &&
    evidence.measuredPages.every((page) => page.basis === "unverified");
  const pageTable = (
    <table className="w-full text-left text-sm">
      <caption className="pb-2 text-start font-medium">
        {report("reportFiles.pagePerformance")}
      </caption>
      <thead>
        <tr>
          <td />
          <th scope="col" className="text-right font-medium">
            {period(evidence)}
          </th>
          {previous && (
            <th scope="col" className="text-right font-medium">
              {report("reportFiles.previousPeriod")}
              <br />
              {period(previous)}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {auditMetrics.map(([key, label]) => (
          <tr key={key} className="border-t">
            <th scope="row" className="py-1 text-start font-normal">
              {report(`metrics.${label}`)}
            </th>
            <td className="text-right tabular-nums">
              {number(evidence[key], key)}
            </td>
            {previous && (
              <td className="text-right tabular-nums">
                {number(previous[key], key)}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <section
      lang="en"
      aria-labelledby={heading}
      className="min-w-0 space-y-3 border-y py-3 text-sm"
    >
      <h3 id={heading} className="font-semibold">
        {report("statistics.search_console")}
      </h3>
      {evidence.opportunities?.length > 0 && (
        <section aria-labelledby={recommendations} className="space-y-2">
          <h4 id={recommendations} className="font-medium">
            {report("reportFiles.recommendations")}
          </h4>
          <ul className="divide-y">
            {evidence.opportunities.map((item) => (
              <li key={item.id} className="space-y-1 py-2">
                <p className="break-words font-medium">{item.title}</p>
                {item.pageUrl && (
                  <p className="break-all text-muted-foreground">
                    {item.pageUrl}
                  </p>
                )}
                <p>{item.why}</p>
                <p>{item.expectedEffect}</p>
                {item.evidence.length > 0 && (
                  <details>
                    <SeoFoldSummary>
                      {report("actions.evidence")}
                    </SeoFoldSummary>
                    <ul className="list-disc space-y-1 ps-5">
                      {item.evidence.map((line) => (
                        <li className="break-words" key={line}>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {evidence.history && (
        <section className="space-y-1">
          <h4 className="font-medium">
            {report("reportFiles.matchedHistory")}
          </h4>
          <p>{period(evidence.history)}</p>
          {evidence.history.clicks !== null && (
            <p>
              {report("reportFiles.matchedClicks", {
                count: evidence.history.clicks,
              })}
            </p>
          )}
          <p>
            {report(`reportFiles.historyDecision.${evidence.history.decision}`)}
          </p>
        </section>
      )}
      {!propertyTotals && (unverified || Boolean(topClickedPages?.length)) && (
        <p className="text-muted-foreground">{period(evidence)}</p>
      )}
      <SeoPropertyPerformance evidence={evidence} />
      {topClickedPages && topClickedPages.length > 0 && (
        <table className="w-full text-sm">
          <caption className="pb-2 text-start font-medium">
            {report("reportFiles.topClickedPages")}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="text-start font-medium">
                {report("page")}
              </th>
              <th scope="col" className="ps-3 text-end font-medium">
                {report("queries.clicks")}
              </th>
              <th scope="col" className="ps-3 text-end font-medium">
                {report("queries.impressions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {topClickedPages.map((page) => (
              <tr key={page.pageUrl} className="border-t">
                <th scope="row" className="py-1.5 text-start font-normal">
                  <SeoPageLink url={page.pageUrl} />
                </th>
                <td className="ps-3 text-end tabular-nums">
                  {format.number(page.clicks)}
                </td>
                <td className="ps-3 text-end tabular-nums">
                  {format.number(page.impressions)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <SeoPropertyPageDiscovery report={evidence} />
      <p className="text-muted-foreground">
        {report("reportFiles.performanceScope")}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>{report("statistics.property")}</dt>
        <dd className="break-all">{evidence.propertyId}</dd>
        <dt>{report("coverage")}</dt>
        <dd>{report(`coverageStatus.${evidence.coverage}`)}</dd>
        <dt>{report("reportFiles.auditedUrls")}</dt>
        <dd>
          <ul className="space-y-2">
            {evidence.measuredPages.map(({ pageUrl, measuredUrl, basis }) => (
              <li className="break-all" key={pageUrl}>
                <span>{pageUrl}</span>
                {basis === "google_canonical" && measuredUrl !== pageUrl && (
                  <p>
                    {report("reportFiles.googleCanonical", {
                      url: measuredUrl,
                    })}
                  </p>
                )}
                {basis === "unverified" && (
                  <p className="break-normal text-muted-foreground">
                    {report("reportFiles.canonicalUnverified")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      {unverified ? (
        <details key={evidence.taskId}>
          <SeoFoldSummary>
            {report("reportFiles.unverifiedPagePerformance")}
          </SeoFoldSummary>
          {pageTable}
        </details>
      ) : (
        pageTable
      )}
      {evidence.discovery && (
        <SeoAuditDiscovery evidence={evidence.discovery} />
      )}
      {queries && queries.rows.length === 0 && (
        <p>{report("reportFiles.noQueryRecommendations")}</p>
      )}
      <details>
        <SeoFoldSummary>{report("queries.title")}</SeoFoldSummary>
        {!queries ? (
          <p>{report("queries.notLoaded")}</p>
        ) : !queries.rows.length ? (
          <p>{report("queries.empty")}</p>
        ) : (
          <ul className="divide-y">
            {queries.rows.map((row) => (
              <li
                key={JSON.stringify([row.query, row.pageUrl])}
                className="space-y-1 py-2"
              >
                <p className="break-words font-medium">{row.query}</p>
                <p className="break-all">{row.pageUrl}</p>
                <dl className="grid grid-cols-[1fr_auto] gap-x-2">
                  {auditMetrics.map(([key, label]) => (
                    <div className="contents" key={key}>
                      <dt>{report(`metrics.${label}`)}</dt>
                      <dd className="text-right tabular-nums">
                        {number(row[key], key)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
        {queries?.truncated && (
          <p>{report("queries.truncated", { count: queries.rows.length })}</p>
        )}
      </details>
    </section>
  );
}
