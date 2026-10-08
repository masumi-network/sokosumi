"use client";

import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
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
  });
  const validRange =
    !filters.publishedFrom ||
    !filters.publishedUntil ||
    filters.publishedFrom <= filters.publishedUntil;
  const queryScope = [
    "social-account-statistics",
    session?.user.id,
    session?.session.activeOrganizationId ?? null,
    projectId,
  ];
  const query = useInfiniteQuery({
    queryKey: [...queryScope, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<StatisticsPage> => {
      const params = new URLSearchParams();
      if (filters.statisticsProvider)
        params.set("provider", filters.statisticsProvider);
      if (filters.statisticsAccount)
        params.set("connectionId", filters.statisticsAccount);
      if (validRange && filters.publishedFrom)
        params.set("publishedFrom", `${filters.publishedFrom}T00:00:00.000Z`);
      if (validRange && filters.publishedUntil)
        params.set("publishedUntil", `${filters.publishedUntil}T23:59:59.999Z`);
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
        !Array.isArray(page.posts)
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
  const posts = validRange
    ? (query.data?.pages.flatMap((page) => page.posts) ?? [])
    : [];
  const runRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const [sync, setSync] = useState<{
    accountId: string;
    completed: number;
    total: number;
    pages: number;
    stopping: boolean;
  } | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  useMountEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current?.abort();
    };
  });

  async function handleSync(targets: Account[]) {
    if (runRef.current || targets.length === 0) return;
    const run = new AbortController();
    runRef.current = run;
    setSyncErrors({});
    let pages = 0;
    try {
      for (const [index, account] of targets.entries()) {
        if (run.signal.aborted) break;
        setSync({
          accountId: account.id,
          completed: index,
          total: targets.length,
          pages,
          stopping: false,
        });
        let continueHistory =
          Boolean(account.statistics?.historyNextCursor) &&
          !account.statistics?.historyComplete;
        while (!run.signal.aborted) {
          try {
            const result = await refreshProjectSocialAccountStatistics({
              projectId,
              connectionId: account.id,
              continueHistory,
            });
            // A request already sent finishes on Core; cancellation prevents the next page.
            if (!mountedRef.current) return;
            if (!result.ok) {
              setSyncErrors((errors) => ({
                ...errors,
                [account.id]: t("accountSyncFailed"),
              }));
              break;
            }
            pages++;
            setSync((current) => (current ? { ...current, pages } : null));
            // Keep the returned cursor even if the follow-up history read fails.
            queryClient.setQueriesData<InfiniteData<StatisticsPage>>(
              { queryKey: queryScope },
              (current) =>
                current
                  ? {
                      ...current,
                      pages: current.pages.map((page) => ({
                        ...page,
                        accounts: page.accounts.map((cached) =>
                          cached.id === result.value.account.id
                            ? result.value.account
                            : cached,
                        ),
                      })),
                    }
                  : current,
            );
            await queryClient.invalidateQueries({ queryKey: queryScope });
            const snapshot = result.value.account.statistics;
            if (
              snapshot?.historyError ||
              snapshot?.historyComplete ||
              !snapshot?.historyNextCursor
            )
              break;
            continueHistory = true;
          } catch {
            if (mountedRef.current)
              setSyncErrors((errors) => ({
                ...errors,
                [account.id]: t("accountSyncFailed"),
              }));
            break;
          }
        }
      }
    } finally {
      runRef.current = null;
      if (mountedRef.current) setSync(null);
    }
  }

  function handleCancel() {
    runRef.current?.abort();
    setSync((current) => (current ? { ...current, stopping: true } : null));
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

  return (
    <div className="space-y-6" data-testid="social-statistics">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
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
      <section className="space-y-3" aria-label={t("accountsTitle")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t("accountsTitle")}</h3>
          <Button
            type="button"
            variant="outline"
            disabled={
              Boolean(sync) ||
              !accounts.some((account) => account.status === "active")
            }
            onClick={() =>
              void handleSync(
                accounts.filter((account) => account.status === "active"),
              )
            }
          >
            {t("syncAll")}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">{t("syncHint")}</p>
        <div role="status" className="text-muted-foreground text-sm">
          {sync
            ? t(sync.stopping ? "stoppingSync" : "syncProgress", {
                completed: sync.completed,
                total: sync.total,
                pages: sync.pages,
              })
            : ""}
        </div>
        {sync ? (
          <Button
            type="button"
            variant="outline"
            disabled={sync.stopping}
            onClick={handleCancel}
          >
            {t("stopSync")}
          </Button>
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
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((account) => {
            const snapshot = account.statistics;
            return (
              <article
                key={account.id}
                className="min-w-0 space-y-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h4 className="flex items-center gap-2 font-medium">
                      <SocialPostProviderIcon
                        provider={account.provider}
                        className="size-5 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 break-words">
                        {account.displayName ??
                          account.externalHandle ??
                          SOCIAL_PROVIDERS.find(
                            (provider) => provider.id === account.provider,
                          )?.name ??
                          account.provider}
                      </span>
                    </h4>
                    <p className="text-muted-foreground text-xs">
                      {SOCIAL_PROVIDERS.find(
                        (provider) => provider.id === account.provider,
                      )?.name ?? account.provider}
                      {account.externalHandle
                        ? ` · ${account.externalHandle}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={sync?.accountId === account.id && !sync.stopping}
                    disabled={Boolean(sync) || account.status !== "active"}
                    onClick={() => void handleSync([account])}
                  >
                    {snapshot?.historyNextCursor && !snapshot.historyComplete
                      ? t("resumeSync")
                      : t("syncAccount")}
                  </Button>
                </div>
                {account.status !== "active" ? (
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
                {snapshot?.metrics.length ? (
                  renderMetrics(snapshot.metrics)
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {snapshot?.fetchedAt
                      ? t("accountMetricsUnavailable")
                      : t("accountNotFetched")}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {snapshot?.fetchedAt
                    ? t("updatedAt", { date: formatDate(snapshot.fetchedAt) })
                    : t("notFetched")}
                </p>
                {snapshot?.error || syncErrors[account.id] ? (
                  <p role="status" className="text-semantic-warning text-sm">
                    {syncErrors[account.id] ?? t("accountMetricsIncomplete")}
                  </p>
                ) : null}
                {snapshot?.metricWarning ? (
                  <p role="status" className="text-semantic-warning text-sm">
                    {t("postMetricsIncomplete")}
                  </p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {t("importedCount", { count: account.postCount })}
                  {snapshot?.historyFetchedAt
                    ? ` · ${t("updatedAt", { date: formatDate(snapshot.historyFetchedAt) })}`
                    : ""}
                </p>
                <p className="text-muted-foreground text-xs">
                  {snapshot?.historyComplete
                    ? t("historyComplete")
                    : snapshot?.historyNextCursor
                      ? t("historyPartial")
                      : t("historyNotFetched")}
                </p>
                {snapshot?.historyError ? (
                  <div role="status" className="space-y-1 text-sm">
                    <p className="text-semantic-warning">
                      {t("historyLimited")}
                    </p>
                    <p className="text-muted-foreground break-words">
                      {snapshot.historyError}
                    </p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
      <section className="space-y-4" aria-label={t("postsTitle")}>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("postsTitle")}</h3>
          <p className="text-muted-foreground text-sm">{t("postsHint")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="statistics-provider">{t("platform")}</Label>
            <Select
              value={filters.statisticsProvider ?? "all"}
              onValueChange={(value) =>
                void setFilters({
                  statisticsProvider: value === "all" ? null : value,
                  statisticsAccount: null,
                })
              }
            >
              <SelectTrigger id="statistics-provider" className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allPlatforms")}</SelectItem>
                {SOCIAL_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="statistics-account">{t("account")}</Label>
            <Select
              value={filters.statisticsAccount ?? "all"}
              onValueChange={(value) =>
                void setFilters({
                  statisticsAccount: value === "all" ? null : value,
                })
              }
            >
              <SelectTrigger id="statistics-account" className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allAccounts")}</SelectItem>
                {accounts
                  .filter(
                    (account) =>
                      !filters.statisticsProvider ||
                      account.provider === filters.statisticsProvider,
                  )
                  .map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.displayName ??
                        account.externalHandle ??
                        account.provider}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="statistics-from">{t("publishedFrom")}</Label>
            <Input
              id="statistics-from"
              type="date"
              value={filters.publishedFrom ?? ""}
              onChange={(event) =>
                void setFilters({ publishedFrom: event.target.value || null })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="statistics-until">{t("publishedUntil")}</Label>
            <Input
              id="statistics-until"
              type="date"
              value={filters.publishedUntil ?? ""}
              min={filters.publishedFrom ?? undefined}
              aria-invalid={!validRange}
              onChange={(event) =>
                void setFilters({ publishedUntil: event.target.value || null })
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
