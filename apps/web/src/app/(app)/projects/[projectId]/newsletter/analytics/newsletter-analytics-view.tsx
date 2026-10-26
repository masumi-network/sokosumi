"use client";

import type { NewsletterAnalytics } from "@sokosumi/core-client";
import { BarChart2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { useState, useTransition } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { DailyBarChart } from "@/components/performance/daily-bar-chart";
import { PerformanceDateRange } from "@/components/performance/performance-date-range";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface NewsletterAnalyticsViewProps {
  projectId: string;
  analytics: NewsletterAnalytics | null;
}
type GrowthMetric =
  | "newActive"
  | "unsubscribed"
  | "bounced"
  | "net"
  | "runningTotal";

export function NewsletterAnalyticsView({
  projectId,
  analytics,
}: NewsletterAnalyticsViewProps) {
  const t = useTranslations("App.Projects.Newsletter.Analytics");
  const issueTranslations = useTranslations("App.Projects.Newsletter.Issues");
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [range, setRange] = useQueryStates(
    { from: parseAsString, to: parseAsString, cursor: parseAsString },
    { shallow: false, startTransition },
  );
  const [growthMetric, setGrowthMetric] =
    useState<GrowthMetric>("runningTotal");
  const [engagementMetric, setEngagementMetric] = useState<
    "uniqueOpens" | "uniqueClicks"
  >("uniqueOpens");
  const from = range.from ?? analytics?.from ?? "";
  const to = range.to ?? analytics?.to ?? "";
  function handlePreset(days: number) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    void setRange({
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      cursor: null,
    });
  }
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap gap-2">
        {[7, 30, 90].map((days) => (
          <Button
            key={days}
            size="sm"
            variant="outline"
            className="h-11 md:h-8"
            onClick={() => handlePreset(days)}
          >
            {t("lastDays", { days })}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <PerformanceDateRange
          idPrefix="newsletter-analytics"
          from={from}
          until={to}
          minUntil={from || undefined}
          fromLabel={t("from")}
          untilLabel={t("to")}
          invalid={!analytics}
          onFromChange={(value) =>
            void setRange({ from: value || null, cursor: null })
          }
          onUntilChange={(value) =>
            void setRange({ to: value || null, cursor: null })
          }
        />
        <Button
          variant="outline"
          onClick={() => void setRange({ from: null, to: null, cursor: null })}
        >
          {t("resetRange")}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">{t("periodNote")}</p>
      {!analytics ? (
        <p role="alert" className="text-semantic-destructive text-sm">
          {t("invalidRange")}
        </p>
      ) : (
        <>
          <NewsletterMetrics totals={analytics.totals} />
          <NewsletterAnalyticsNotes />
          {analytics.issuesPagination.total === 0 ? (
            <EmptyState
              icon={BarChart2}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
              action={
                <Button asChild variant="outline">
                  <Link href={`/projects/${projectId}/newsletter/issues`}>
                    {t("viewIssues")}
                  </Link>
                </Button>
              }
            />
          ) : null}
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <section
              aria-labelledby="subscriber-growth-heading"
              className="bg-card min-w-0 space-y-4 rounded-xl border p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3
                  id="subscriber-growth-heading"
                  className="text-base font-semibold"
                >
                  {t("subscriberGrowth")}
                </h3>
                <div>
                  <Label htmlFor="newsletter-growth-metric" className="sr-only">
                    {t("growthMetric")}
                  </Label>
                  <Select
                    value={growthMetric}
                    onValueChange={(value) => {
                      if (
                        value === "newActive" ||
                        value === "unsubscribed" ||
                        value === "bounced" ||
                        value === "net" ||
                        value === "runningTotal"
                      )
                        setGrowthMetric(value);
                    }}
                  >
                    <SelectTrigger id="newsletter-growth-metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        [
                          "runningTotal",
                          "newActive",
                          "unsubscribed",
                          "bounced",
                          "net",
                        ] as const
                      ).map((metric) => (
                        <SelectItem key={metric} value={metric}>
                          {t(`growth.${metric}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DailyBarChart
                label={t(`growth.${growthMetric}`)}
                unavailable={t("unavailable")}
                points={analytics.subscriberGrowth.map((day) => ({
                  date: day.date,
                  value: day[growthMetric],
                }))}
              />
            </section>
            <section
              aria-labelledby="newsletter-engagement-heading"
              className="bg-card min-w-0 space-y-4 rounded-xl border p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3
                  id="newsletter-engagement-heading"
                  className="text-base font-semibold"
                >
                  {t("engagement")}
                </h3>
                <div>
                  <Label
                    htmlFor="newsletter-engagement-metric"
                    className="sr-only"
                  >
                    {t("engagementMetric")}
                  </Label>
                  <Select
                    value={engagementMetric}
                    onValueChange={(value) => {
                      if (value === "uniqueOpens" || value === "uniqueClicks")
                        setEngagementMetric(value);
                    }}
                  >
                    <SelectTrigger id="newsletter-engagement-metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["uniqueOpens", "uniqueClicks"] as const).map(
                        (metric) => (
                          <SelectItem key={metric} value={metric}>
                            {t(`metrics.${metric}`)}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DailyBarChart
                label={t(`metrics.${engagementMetric}`)}
                unavailable={t("unavailable")}
                points={analytics.engagement.map((day) => ({
                  date: day.date,
                  value: day[engagementMetric],
                }))}
              />
            </section>
          </div>
          {analytics.issues.length || analytics.issuesPagination.cursor ? (
            <section
              aria-labelledby="newsletter-issue-performance"
              className="min-w-0 space-y-4"
            >
              <h3
                id="newsletter-issue-performance"
                className="text-base font-semibold"
              >
                {t("issuePerformance")}
              </h3>
              <p className="text-muted-foreground text-sm">
                {t("issueUnsubscribesNote")}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("subject")}</TableHead>
                    <TableHead>{t("sentAt")}</TableHead>
                    {(
                      [
                        "sent",
                        "uniqueOpens",
                        "uniqueClicks",
                        "unsubscribes",
                        "openRate",
                        "clickRate",
                      ] as const
                    ).map((key) => (
                      <TableHead key={key} className="text-end">
                        {t(`metrics.${key}`)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.issues.map((issue) => (
                    <TableRow key={issue.id}>
                      <TableCell className="min-w-40 whitespace-normal">
                        <Link
                          className="underline underline-offset-4"
                          href={`/projects/${projectId}/newsletter/issues/${issue.id}`}
                        >
                          {issue.subject}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {issue.sentAt
                          ? format.dateTime(issue.sentAt, "dateTime")
                          : t("unavailable")}
                      </TableCell>
                      {(
                        [
                          "sent",
                          "uniqueOpens",
                          "uniqueClicks",
                          "unsubscribes",
                          "openRate",
                          "clickRate",
                        ] as const
                      ).map((key) => (
                        <TableCell key={key} className="text-end tabular-nums">
                          {issue[key] == null
                            ? t("unavailable")
                            : format.number(
                                issue[key],
                                key === "openRate" || key === "clickRate"
                                  ? {
                                      style: "percent",
                                      maximumFractionDigits: 1,
                                    }
                                  : {},
                              )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground text-sm" role="status">
                  {issueTranslations("results", {
                    count: analytics.issuesPagination.total,
                  })}
                </p>
                {analytics.issuesPagination.cursor ||
                analytics.issuesPagination.nextCursor ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!analytics.issuesPagination.cursor || pending}
                      loading={pending}
                      onClick={() => void setRange({ cursor: null })}
                    >
                      {issueTranslations("firstPage")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        !analytics.issuesPagination.nextCursor || pending
                      }
                      loading={pending}
                      onClick={() =>
                        void setRange({
                          cursor: analytics.issuesPagination.nextCursor,
                        })
                      }
                    >
                      {issueTranslations("nextPage")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
