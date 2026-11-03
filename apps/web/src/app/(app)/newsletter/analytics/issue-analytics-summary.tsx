"use client";

import type { NewsletterIssueAnalytics } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  NewsletterAnalyticsNotes,
  NewsletterMetrics,
} from "./newsletter-metrics";

export function IssueAnalyticsSummary({
  analytics,
}: {
  analytics: NewsletterIssueAnalytics;
}) {
  const t = useTranslations("App.Projects.Newsletter.Analytics");
  const format = useFormatter();
  return (
    <section
      aria-labelledby="issue-analytics-heading"
      className="min-w-0 space-y-4 rounded-xl border p-6"
    >
      <h3 id="issue-analytics-heading" className="text-base font-semibold">
        {t("issueSummary")}
      </h3>
      <NewsletterMetrics totals={analytics.totals} compact />
      <NewsletterAnalyticsNotes />
      <h4 className="text-sm font-semibold">{t("topLinks")}</h4>
      {analytics.topLinks.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("url")}</TableHead>
              <TableHead className="text-end">
                {t("metrics.uniqueClicks")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analytics.topLinks.map((link) => (
              <TableRow key={link.url}>
                <TableCell className="whitespace-normal">
                  <bdi className="break-all">{link.url}</bdi>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {format.number(link.uniqueClicks)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noLinks")}</p>
      )}
    </section>
  );
}
