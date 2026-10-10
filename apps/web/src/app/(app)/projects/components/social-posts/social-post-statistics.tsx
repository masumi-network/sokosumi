"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useRef, useState } from "react";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { SOCIAL_PROVIDERS } from "@/components/social-providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { refreshProjectSocialAccountStatistics } from "@/lib/actions/project/action";
import { useSession } from "@/lib/auth/auth.client";
import type { projectService } from "@/lib/services/project.service";
import { PerformanceTrendChart } from "./performance-trend-chart";
import { SocialPerformanceOverview } from "./social-performance-overview";
import { SocialPostMetrics } from "./social-post-metrics";

const ACCOUNT_METRIC_LABELS: Record<string, string> = {
  followers_count: "followers",
  follows_count: "following",
  following_count: "following",
  tweet_count: "posts",
  listed_count: "lists",
  posts_liked_count: "postsLiked",
  viewCount: "views",
  videoCount: "videos",
  subscriberCount: "subscribers",
  accounts_engaged: "engagedAccounts",
  total_interactions: "interactions",
  profile_links_taps: "profileLinkClicks",
  page_media_view: "views",
  page_post_engagements: "engagement",
  page_video_views: "video_views",
  page_daily_follows_unique: "newFollowers",
  page_daily_unfollows_unique: "lostFollowers",
  page_total_actions: "actions",
  page_total_media_view_unique: "reach",
  estimatedMinutesWatched: "watch_time",
  averageViewDuration: "averageWatchDuration",
  averageViewPercentage: "averageViewedPercent",
  subscribersGained: "newSubscribers",
  subscribersLost: "lostSubscribers",
  post_media_view: "views",
  post_total_media_view_unique: "reach",
  url_clicks: "linkClicks",
  saved: "saves",
  like_count: "likes",
  comment_count: "comments",
  share_count: "shares",
  save_count: "saves",
  likes_count: "likes_received",
};

type StatisticsPage = Awaited<
  ReturnType<typeof projectService.listSocialAccountStatistics>
>;
type Account = StatisticsPage["accounts"][number];
type Metric = NonNullable<Account["statistics"]>["metrics"][number];

function utcPreset(days: 7 | 30 | 90) {
  const until = new Date();
  const from = new Date(
    Date.UTC(
      until.getUTCFullYear(),
      until.getUTCMonth(),
      until.getUTCDate() - days + 1,
    ),
  );
  return {
    from: from.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

function accountName(account: Account) {
  return (
    account.displayName ??
    account.externalHandle ??
    SOCIAL_PROVIDERS.find((provider) => provider.id === account.provider)
      ?.name ??
    account.provider
  );
}

export function SocialPostStatistics({ projectId }: { projectId: string }) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useQueryStates({
    statisticsProvider: parseAsString,
    statisticsAccount: parseAsString,
    publishedFrom: parseAsString,
    publishedUntil: parseAsString,
    performanceRange: parseAsStringLiteral(["7", "30", "90"]),
  });
  const validRange =
    !filters.publishedFrom ||
    !filters.publishedUntil ||
    filters.publishedFrom <= filters.publishedUntil;
  const preset =
    filters.performanceRange ??
    (!filters.publishedFrom && !filters.publishedUntil ? "30" : null);
  const publishedFrom =
    validRange &&
    (filters.publishedFrom ??
      (preset ? utcPreset(Number(preset) as 7 | 30 | 90).from : null));
  const publishedUntil =
    validRange &&
    (filters.publishedUntil ??
      (preset ? utcPreset(Number(preset) as 7 | 30 | 90).until : null));
  const queryScope = [
    "social-account-statistics",
    session?.user.id,
    session?.session.activeOrganizationId ?? null,
    projectId,
  ];
  const query = useInfiniteQuery({
    queryKey: [...queryScope, filters, publishedFrom, publishedUntil],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<StatisticsPage> => {
      const params = new URLSearchParams();
      if (filters.statisticsProvider)
        params.set("provider", filters.statisticsProvider);
      if (filters.statisticsAccount)
        params.set("connectionId", filters.statisticsAccount);
      if (publishedFrom)
        params.set("publishedFrom", `${publishedFrom}T00:00:00.000Z`);
      if (publishedUntil)
        params.set("publishedUntil", `${publishedUntil}T23:59:59.999Z`);
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/social-statistics?${params}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("loadFailed"));
      const page: StatisticsPage = await response.json();
      if (
        !page ||
        !Array.isArray(page.accounts) ||
        !Array.isArray(page.posts) ||
        !page.headline?.current
      ) {
        throw new Error(t("loadFailed"));
      }
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(session?.user.id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const accounts = query.data?.pages[0]?.accounts ?? [];
  const accountsById = new Map(
    accounts.map((account) => [account.id, account]),
  );
  const selectedAccount =
    accounts.find((account) => account.id === filters.statisticsAccount) ??
    null;
  const impressionBased =
    selectedAccount?.provider === "x" ||
    selectedAccount?.provider === "linkedin";
  const headline = query.data?.pages[0]?.headline;
  const posts = validRange
    ? (query.data?.pages.flatMap((page) => page.posts) ?? [])
    : [];
  const enqueueingRef = useRef(false);
  const mountedRef = useRef(false);
  const [enqueueingId, setEnqueueingId] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  useMountEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  });

  async function handleSync(targets: Account[]) {
    if (enqueueingRef.current || targets.length === 0) return;
    enqueueingRef.current = true;
    setSyncErrors({});
    try {
      for (const account of targets) {
        setEnqueueingId(account.id);
        try {
          const result = await refreshProjectSocialAccountStatistics({
            projectId,
            connectionId: account.id,
          });
          if (!mountedRef.current) return;
          if (!result.ok) {
            setSyncErrors((errors) => ({
              ...errors,
              [account.id]: t("accountSyncFailed"),
            }));
          }
        } catch {
          if (mountedRef.current)
            setSyncErrors((errors) => ({
              ...errors,
              [account.id]: t("accountSyncFailed"),
            }));
        }
      }
      if (mountedRef.current)
        await queryClient.invalidateQueries({ queryKey: queryScope });
    } finally {
      enqueueingRef.current = false;
      if (mountedRef.current) setEnqueueingId(null);
    }
  }

  function metricLabel(metric: Metric) {
    const key = `accountMetrics.${ACCOUNT_METRIC_LABELS[metric.key] ?? metric.key}`;
    return t.has(key)
      ? t(key)
      : metric.key
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replaceAll(/[_.-]/g, " ");
  }
  function renderMetrics(metrics: Metric[]) {
    return (
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
        {metrics.map((metric, index) => (
          <div
            key={`${metric.key}-${metric.period}-${index}`}
            className="space-y-1"
          >
            <dt className="text-muted-foreground break-words">
              {metricLabel(metric)}
            </dt>
            <dd className="font-medium tabular-nums">
              {metric.value == null
                ? t("unavailable")
                : formatter.number(metric.value)}
              {metric.unit &&
              metric.unit !== "count" &&
              metric.value != null ? (
                <span className="text-muted-foreground ms-1 font-normal">
                  {t.has(`units.${metric.unit}`)
                    ? t(`units.${metric.unit}`)
                    : metric.unit}
                </span>
              ) : null}
            </dd>
            {metric.period ? (
              <dd className="text-muted-foreground text-xs">
                {t.has(`periods.${metric.period}`)
                  ? t(`periods.${metric.period}`)
                  : metric.period.replaceAll(/[_-]/g, " ")}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    );
  }
  function formatDate(value: string | Date) {
    return formatter.dateTime(new Date(value), "dateTime", {
      timeZone: "UTC",
      timeZoneName: "short",
    });
  }
  function formatUpdated(value: string | Date) {
    return formatter.dateTime(new Date(value), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  }
  function handlePreset(days: "7" | "30" | "90") {
    const window = utcPreset(Number(days) as 7 | 30 | 90);
    void setFilters({
      performanceRange: days,
      publishedFrom: window.from,
      publishedUntil: window.until,
    });
  }
  const statusAccount = selectedAccount ?? accounts[0];
  const statusSnapshot = statusAccount?.statistics;

  return (
    <div className="space-y-6" data-testid="social-statistics">
      <div role="status" className="text-muted-foreground text-sm">
        {query.isPending ? t("loading") : ""}
      </div>
      {query.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm">{t("loadFailed")}</p>
          <Button
            variant="outline"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {!query.isPending && !query.isError && accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("noAccounts")}{" "}
          <Link
            className="underline underline-offset-4"
            href={`/social?projectId=${encodeURIComponent(projectId)}&tab=accounts`}
          >
            {t("manageAccounts")}
          </Link>
        </p>
      ) : null}
      {accounts.length > 0 ? (
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:flex-1 sm:flex-row sm:items-center sm:gap-3">
              <Select
                value={filters.statisticsAccount ?? "all"}
                onValueChange={(value) =>
                  void setFilters({
                    statisticsAccount: value === "all" ? null : value,
                    statisticsProvider: null,
                  })
                }
              >
                <SelectTrigger
                  aria-label={t("performance.accountTabs")}
                  className="text-foreground w-full sm:w-auto sm:min-w-[200px]"
                >
                  <div className="flex items-center gap-2">
                    {selectedAccount ? (
                      <SocialPostProviderIcon
                        provider={selectedAccount.provider}
                        className="size-4 shrink-0"
                        aria-hidden
                      />
                    ) : null}
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allAccounts")}</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      <div className="flex items-center gap-2">
                        <SocialPostProviderIcon
                          provider={account.provider}
                          className="size-4 shrink-0"
                          aria-hidden
                        />
                        <span className="truncate">{accountName(account)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-muted-foreground min-w-0 text-sm">
                {statusSnapshot?.fetchedAt ? (
                  <p>
                    {t("updatedAt", {
                      date: formatUpdated(statusSnapshot.fetchedAt),
                    })}
                  </p>
                ) : (
                  <p>{t("notFetched")}</p>
                )}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={Boolean(enqueueingId)}
              disabled={
                Boolean(enqueueingId) ||
                (selectedAccount
                  ? selectedAccount.status !== "active"
                  : !accounts.some((account) => account.status === "active"))
              }
              onClick={() =>
                void handleSync(
                  selectedAccount
                    ? [selectedAccount]
                    : accounts.filter((account) => account.status === "active"),
                )
              }
            >
              {statusSnapshot?.historyNextCursor &&
              !statusSnapshot.historyComplete
                ? t("resumeSync")
                : selectedAccount || accounts.length === 1
                  ? t("syncAccount")
                  : t("syncAll")}
            </Button>
          </div>
          {statusAccount?.status && statusAccount.status !== "active" ? (
            <p className="text-semantic-warning text-sm">
              {t("reconnectHint")}{" "}
              <Link
                className="underline underline-offset-4"
                href={`/social?projectId=${encodeURIComponent(projectId)}&tab=accounts`}
              >
                {t("manageAccounts")}
              </Link>
            </p>
          ) : null}
          {statusAccount &&
          (statusSnapshot?.error || syncErrors[statusAccount.id]) ? (
            <p role="status" className="text-semantic-warning text-sm">
              {syncErrors[statusAccount.id] ?? t("accountMetricsIncomplete")}
            </p>
          ) : null}
          {statusSnapshot?.metricWarning ? (
            <p role="status" className="text-semantic-warning text-sm">
              {t("postMetricsIncomplete")}
            </p>
          ) : null}
          {statusSnapshot?.historyComplete ? (
            <p className="text-muted-foreground text-xs">
              {t("historyComplete")}
            </p>
          ) : null}
          {statusSnapshot?.historyError ? (
            <div role="status" className="space-y-1 text-sm">
              <p className="text-semantic-warning">{t("historyLimited")}</p>
              <p className="text-muted-foreground break-words">
                {statusSnapshot.historyError}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {(["7", "30", "90"] as const).map((days) => (
          <Button
            key={days}
            size="sm"
            type="button"
            variant={preset === days ? "default" : "outline"}
            onClick={() => handlePreset(days)}
          >
            {t("performance.lastDays", { days: Number(days) })}
          </Button>
        ))}
      </div>
      {headline ? (
        <SocialPerformanceOverview
          headline={headline}
          impressionBased={impressionBased}
        />
      ) : null}
      {headline?.daily.length ? (
        <PerformanceTrendChart
          days={headline.daily}
          impressionBased={impressionBased}
        />
      ) : null}
      <section className="space-y-4" aria-label={t("postsTitle")}>
        <h3 className="text-sm font-semibold">{t("postsTitle")}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="statistics-from">{t("publishedFrom")}</Label>
            <Input
              id="statistics-from"
              type="date"
              value={filters.publishedFrom ?? (publishedFrom || "")}
              onChange={(event) =>
                void setFilters({
                  publishedFrom: event.target.value || null,
                  performanceRange: null,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="statistics-until">{t("publishedUntil")}</Label>
            <Input
              id="statistics-until"
              type="date"
              value={filters.publishedUntil ?? (publishedUntil || "")}
              min={filters.publishedFrom ?? undefined}
              aria-invalid={!validRange}
              onChange={(event) =>
                void setFilters({
                  publishedUntil: event.target.value || null,
                  performanceRange: null,
                })
              }
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void setFilters({
                statisticsProvider: null,
                statisticsAccount: null,
                publishedFrom: null,
                publishedUntil: null,
                performanceRange: null,
              })
            }
          >
            {t("clearFilters")}
          </Button>
        </div>
        {!validRange ? (
          <p role="alert" className="text-semantic-destructive text-sm">
            {t("invalidRange")}
          </p>
        ) : null}
        {!query.isPending &&
        !query.isError &&
        validRange &&
        posts.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            {t("empty")}
          </p>
        ) : null}
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {accountsById.get(post.connectionId)?.displayName ??
                    accountsById.get(post.connectionId)?.externalHandle ??
                    SOCIAL_PROVIDERS.find(
                      (provider) => provider.id === post.provider,
                    )?.name ??
                    post.provider}
                </p>
                <p className="text-muted-foreground text-xs">
                  {post.publishedAt
                    ? formatDate(post.publishedAt)
                    : t("dateUnavailable")}
                </p>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">
                {post.text || t("mediaPost")}
              </p>
              {post.url ? (
                <a
                  className="inline-block text-sm underline underline-offset-4"
                  href={post.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("openPost")}
                </a>
              ) : null}
              <SocialPostMetrics
                statistics={{
                  metrics: post.metrics,
                  fetchedAt: post.fetchedAt,
                  refreshAttemptedAt: null,
                  error: null,
                }}
              />
              {post.additionalMetrics.length
                ? renderMetrics(post.additionalMetrics)
                : null}
            </li>
          ))}
        </ul>
        {query.hasNextPage && validRange ? (
          <Button
            variant="outline"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t("loadMore")}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
