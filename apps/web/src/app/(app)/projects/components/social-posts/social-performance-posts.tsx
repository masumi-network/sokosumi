"use client";

import type { SocialPerformanceResponse } from "@sokosumi/core-client";
import { ArrowUpRight, ChevronDown, LayoutGrid, List } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACCOUNT_METRIC_LABELS } from "./social-post-metrics";
import { SocialPostPerformanceCard } from "./social-post-performance-card";

type PerformancePost = SocialPerformanceResponse["posts"][number];

export function SocialPerformancePosts({
  data,
  projectNames = {},
  postProjects = {},
}: {
  data: SocialPerformanceResponse;
  projectNames?: Record<string, string>;
  postProjects?: Record<string, string[]>;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const [view, setView] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = data.posts.filter((post) => selectedIds.includes(post.id));
  const accountsById = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  function number(value: number | null) {
    return value == null
      ? "—"
      : format.number(value, { maximumFractionDigits: 2 });
  }
  function rate(post: PerformancePost) {
    return post.engagementRate == null
      ? "—"
      : `${number(post.engagementRate)}%`;
  }
  function metricPeriod(period: string | null) {
    if (!period) return null;
    if (period.startsWith("lifetime:")) {
      const measuredAt = new Date(period.slice("lifetime:".length));
      if (!Number.isNaN(measuredAt.getTime()))
        return t("performance.metricMeasuredAt", {
          date: format.dateTime(measuredAt, "dateTime", {
            timeZone: data.range.timezone,
            timeZoneName: "short",
          }),
        });
    }
    return t.has(`periods.${period}`)
      ? t(`periods.${period}`)
      : period.replaceAll("_", " ");
  }
  function toggle(postId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? [
            ...current.filter((id) =>
              data.posts.some((post) => post.id === id),
            ),
            postId,
          ].slice(0, 3)
        : current.filter((id) => id !== postId),
    );
  }
  function selection(post: PerformancePost) {
    return (
      <label className="text-muted-foreground flex min-h-10 cursor-pointer items-center gap-2 text-xs">
        <Checkbox
          checked={selectedIds.includes(post.id)}
          disabled={selected.length >= 3 && !selectedIds.includes(post.id)}
          onCheckedChange={(checked) => toggle(post.id, checked === true)}
        />
        <span>
          {t("performance.selectCompare")}
          <span className="sr-only">: {post.text || t("mediaPost")}</span>
        </span>
      </label>
    );
  }
  function derived(post: PerformancePost) {
    return (
      <dl className="grid grid-cols-3 gap-3 border-t pt-3 text-xs">
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {t("performance.interactions")}
          </dt>
          <dd className="font-medium tabular-nums">
            {number(post.interactions)}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {t("performance.engagementRate")}
          </dt>
          <dd
            className="font-medium tabular-nums"
            title={
              post.engagementDenominator
                ? t("performance.rateDenominator", {
                    metric: t(`metrics.${post.engagementDenominator}`),
                  })
                : undefined
            }
          >
            {rate(post)}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">{t("performance.baseline")}</dt>
          <dd className="font-medium tabular-nums">
            {post.baselineMultiplier == null
              ? "—"
              : t("performance.multiplier", {
                  value: number(post.baselineMultiplier),
                })}
          </dd>
        </div>
      </dl>
    );
  }
  function preview(post: PerformancePost) {
    return (
      <SocialPostPerformanceCard
        post={post}
        account={accountsById.get(post.connectionId)}
        footer={
          <>
            {derived(post)}
            {postProjects[post.id]?.length ? (
              <p className="text-muted-foreground text-xs">
                {postProjects[post.id]
                  ?.map((id) => projectNames[id] ?? id)
                  .join(" · ")}
              </p>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          {post.additionalMetrics.length ? (
            <dl className="grid grid-cols-2 gap-3 text-xs">
              {post.additionalMetrics.map((metric, index) => (
                <div key={`${metric.key}-${index}`}>
                  <dt className="text-muted-foreground break-words">
                    {t.has(
                      `accountMetrics.${ACCOUNT_METRIC_LABELS[metric.key] ?? metric.key}`,
                    )
                      ? t(
                          `accountMetrics.${ACCOUNT_METRIC_LABELS[metric.key] ?? metric.key}`,
                        )
                      : metric.key.replaceAll("_", " ")}
                  </dt>
                  <dd className="mt-1 tabular-nums">
                    {number(metric.value)}
                    {metric.unit && metric.unit !== "count"
                      ? ` ${t.has(`units.${metric.unit}`) ? t(`units.${metric.unit}`) : metric.unit}`
                      : ""}
                  </dd>
                  {metric.period ? (
                    <dd className="text-muted-foreground mt-1 text-xs">
                      {metricPeriod(metric.period)}
                    </dd>
                  ) : null}
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </SocialPostPerformanceCard>
    );
  }
  return (
    <section
      className="space-y-4"
      aria-label={t("postsTitle")}
      data-testid="social-performance-posts"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("postsTitle")}</h3>
          <p className="text-muted-foreground text-xs">
            {t("performance.postCount", {
              shown: data.posts.length,
              total: data.pagination.total,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={view === "cards" ? "default" : "outline"}
            aria-pressed={view === "cards"}
            onClick={() => setView("cards")}
          >
            <LayoutGrid className="size-4" aria-hidden />
            {t("performance.cards")}
          </Button>
          <Button
            size="sm"
            variant={view === "table" ? "default" : "outline"}
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            <List className="size-4" aria-hidden />
            {t("performance.table")}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        {t("performance.baselineHint", {
          days: data.baseline.windowDays,
          recent: data.baseline.excludeRecentDays,
          count: data.baseline.minimumSampleSize,
        })}
      </p>
      {selected.length ? (
        <section
          className="bg-card space-y-3 rounded-xl border p-4"
          aria-label={t("performance.comparePosts", { count: selected.length })}
        >
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium">
              {t("performance.comparePosts", { count: selected.length })}
            </h4>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds([])}
            >
              {t("performance.clearSelection")}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {t("performance.compareHint")}
          </p>
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {selected.map((post) => (
              <div key={post.id} className="min-w-0 space-y-3">
                {preview(post)}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggle(post.id, false)}
                >
                  {t("performance.removeCompare")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {data.posts.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {t("empty")}
        </p>
      ) : view === "cards" ? (
        <ul className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.posts.map((post) => (
            <li key={post.id} className="min-w-0 space-y-2">
              {selection(post)}
              {preview(post)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("performance.compare")}</TableHead>
                <TableHead>{t("performance.post")}</TableHead>
                <TableHead className="text-end">{t("metrics.views")}</TableHead>
                <TableHead className="text-end">
                  {t("metrics.impressions")}
                </TableHead>
                <TableHead className="text-end">
                  {t("performance.interactions")}
                </TableHead>
                <TableHead className="text-end">
                  {t("performance.engagementRate")}
                </TableHead>
                <TableHead className="text-end">
                  {t("performance.baseline")}
                </TableHead>
                <TableHead className="text-end">
                  {t("performance.published")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell>{selection(post)}</TableCell>
                  <TableCell className="w-80 min-w-56 max-w-96 whitespace-normal">
                    <details className="group">
                      <summary className="cursor-pointer list-none space-y-2 rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center gap-2 text-xs">
                          <SocialPostProviderIcon
                            provider={post.provider}
                            className="size-4 shrink-0"
                            aria-hidden
                          />
                          {accountsById.get(post.connectionId)?.displayName ??
                            accountsById.get(post.connectionId)
                              ?.externalHandle ??
                            post.provider}
                          <ChevronDown
                            className="ms-auto size-3.5 group-open:rotate-180"
                            aria-hidden
                          />
                        </span>
                        <span className="line-clamp-2 break-words text-sm">
                          {post.text || t("mediaPost")}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t("performance.previewPost")}
                        </span>
                      </summary>
                      <div className="py-3">{preview(post)}</div>
                    </details>
                    {post.url ? (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-muted-foreground flex min-h-10 w-fit items-center gap-1 rounded-sm text-xs underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {t("openPost")}
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {number(post.metrics.views)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {number(post.metrics.impressions)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {number(post.interactions)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {rate(post)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {post.baselineMultiplier == null
                      ? "—"
                      : t("performance.multiplier", {
                          value: number(post.baselineMultiplier),
                        })}
                  </TableCell>
                  <TableCell className="text-end text-xs">
                    {post.publishedAt
                      ? format.dateTime(
                          new Date(post.publishedAt),
                          "dateTime",
                          {
                            timeZone: data.range.timezone,
                            timeZoneName: "short",
                          },
                        )
                      : t("dateUnavailable")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.pagination.truncated ? (
        <p className="text-muted-foreground text-xs">
          {t("performance.truncated")}
        </p>
      ) : null}
    </section>
  );
}
