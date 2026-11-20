"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useId } from "react";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { SeoFoldSummary } from "./seo-shared";

type Evidence = NonNullable<ProjectSeoWorkspace["auditSearchConsole"]>[number];
const metrics = [
  ["clicks", "clicks"],
  ["impressions", "impressions"],
  ["ctr", "ctr"],
  ["averagePosition", "average_position"],
] as const;

export function SeoAuditSearchConsole({ evidence }: { evidence: Evidence }) {
  const report = useSeoResultTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const heading = useId();
  const recommendations = useId();
  const period = (value: Pick<Evidence, "from" | "to">) =>
    report("reportFiles.period", {
      from: new Date(value.from).toISOString().slice(0, 10),
      to: new Date(value.to).toISOString().slice(0, 10),
    });
  const number = (value: number | null, key: string) =>
    value === null
      ? report("coverageStatus.unavailable")
      : format.number(
          value,
          key === "ctr"
            ? { style: "percent", maximumFractionDigits: 1 }
            : { maximumFractionDigits: 1 },
        );
  const { previous, queries } = evidence;
  return (
    <section
      lang="en"
      aria-labelledby={heading}
      className="min-w-0 space-y-3 border-y py-3 text-sm"
    >
      <h3 id={heading} className="font-semibold">
        {report("statistics.search_console")}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
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
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          {report("statistics.search_console")}
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
          {metrics.map(([key, label]) => (
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
              </li>
            ))}
          </ul>
        </section>
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
                  {metrics.map(([key, label]) => (
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
