"use client";

import type { NewsletterAnalytics } from "@sokosumi/core-client";
import { BarChart2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { useState, useTransition } from "react";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import { EmptyState } from "@/components/common/empty-state";
import { DailyBarChart } from "@/components/performance/daily-bar-chart";
import { PerformanceDateRange } from "@/components/performance/performance-date-range";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
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
import { cn } from "@/lib/utils";
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

const ISSUE_METRICS = [
  "sent",
  "uniqueOpens",
  "uniqueClicks",
  "unsubscribes",
  "openRate",
  "clickRate",
] as const;

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
  const issueItems = (analytics?.issues ?? []).map((issue) => ({
    issue,
    href: newsletterHref(
      `/newsletter/issues/${encodeURIComponent(issue.id)}`,
      projectId,
    ),
    sentAt: issue.sentAt
      ? format.dateTime(issue.sentAt, "dateTime")
      : t("unavailable"),
    metrics: ISSUE_METRICS.map((key) => ({
      key,
      label: t(`metrics.${key}`),
      value:
        issue[key] == null
          ? t("unavailable")
          : format.number(
              issue[key],
              key === "openRate" || key === "clickRate"
                ? { style: "percent", maximumFractionDigits: 1 }
                : {},
            ),
    })),
  }));
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
      <div className={cn(HOLDER_CLASS, "min-w-0 space-y-3 p-3")}>
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
            onClick={() =>
              void setRange({ from: null, to: null, cursor: null })
            }
          >
            {t("resetRange")}
          </Button>
        </div>
        <p className="text-muted-foreground px-1 text-sm">{t("periodNote")}</p>
      </div>
      {!analytics ? (
        <p role="alert" className="text-semantic-destructive text-sm">
          {t("invalidRange")}
        </p>
      ) : (
        <>
          <NewsletterMetrics totals={analytics.totals} />
          <NewsletterAnalyticsNotes />
          {analytics.issuesPagination.total === 0 ? (
            <div className={HOLDER_CLASS}>
              <EmptyState
                icon={BarChart2}
                title={t("emptyTitle")}
                description={t("emptyDescription")}
                action={
                  <Button asChild variant="outline">
                    <Link
                      href={newsletterHref("/newsletter/issues", projectId)}
                    >
                      {t("viewIssues")}
                    </Link>
                  </Button>
                }
              />
            </div>
          ) : null}
          <div
            className={cn(
              HOLDER_CLASS,
              "grid min-w-0 gap-3 p-3 xl:grid-cols-2",
            )}
          >
            <section
              aria-labelledby="subscriber-growth-heading"
              className="bg-card min-w-0 space-y-4 rounded-xl border p-4 sm:p-6"
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
              className="bg-card min-w-0 space-y-4 rounded-xl border p-4 sm:p-6"
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
              <div className={cn(HOLDER_CLASS, "min-w-0")} aria-busy={pending}>
                <ul
                  aria-label={t("issuePerformance")}
                  className="grid min-w-0 gap-2 lg:grid-cols-2 xl:hidden"
                >
                  {issueItems.map((item) => (
                    <li
                      key={item.issue.id}
                      className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}
                    >
                      <h4 className="text-sm font-semibold wrap-anywhere">
                        <Link
                          href={item.href}
                          className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {item.issue.subject}
                        </Link>
                      </h4>
                      <dl className="grid grid-cols-2 gap-4 text-sm">
                        <div className="col-span-2 min-w-0 space-y-1">
                          <dt className="text-muted-foreground">
                            {t("sentAt")}
                          </dt>
                          <dd className="wrap-anywhere">{item.sentAt}</dd>
                        </div>
                        {item.metrics.map((metric) => (
                          <div key={metric.key} className="min-w-0 space-y-1">
                            <dt className="text-muted-foreground wrap-anywhere">
                              {metric.label}
                            </dt>
                            <dd className="font-medium tabular-nums wrap-anywhere">
                              {metric.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
                <Table
                  containerClassName={cn(
                    HOLDER_ITEM_CLASS,
                    "hidden min-w-0 xl:block",
                  )}
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("subject")}</TableHead>
                      <TableHead>{t("sentAt")}</TableHead>
                      {ISSUE_METRICS.map((key) => (
                        <TableHead key={key} className="text-end">
                          {t(`metrics.${key}`)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issueItems.map((item) => (
                      <TableRow key={item.issue.id}>
                        <TableCell className="min-w-40 whitespace-normal wrap-anywhere">
                          <Link
                            className="underline underline-offset-4"
                            href={item.href}
                          >
                            {item.issue.subject}
                          </Link>
                        </TableCell>
                        <TableCell>{item.sentAt}</TableCell>
                        {item.metrics.map((metric) => (
                          <TableCell
                            key={metric.key}
                            className="text-end tabular-nums"
                          >
                            {metric.value}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
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
