"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart2, Download, MoreVertical } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { SOCIAL_PROVIDERS } from "@/components/social-providers";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { refreshProjectSocialAccountStatistics } from "@/lib/actions/project/action";
import { useSession } from "@/lib/auth/auth.client";
import type { projectService } from "@/lib/services/project.service";
import { socialSyncPollIntervalMs } from "@/lib/social-sync-poll";
import { PerformanceTrendChart } from "./performance-trend-chart";
import { PostingConsistency } from "./posting-consistency";
import { SocialPerformanceOverview } from "./social-performance-overview";
import { SocialPublishedPost } from "./social-published-post";

type StatisticsPage = Awaited<
  ReturnType<typeof projectService.listSocialAccountStatistics>
>;
type Account = StatisticsPage["accounts"][number];

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

function PerformanceQuerySkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      className="space-y-6"
      data-testid="social-statistics-loading"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, card) => (
          <div
            key={card}
            className="border-border space-y-3 rounded-lg border p-4"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-4 w-48" />
        {Array.from({ length: 2 }, (_, card) => (
          <div
            key={card}
            className="grid min-w-0 gap-6 rounded-xl border p-4 lg:grid-cols-2"
            data-testid="social-published-post-skeleton"
          >
            <div className="w-full min-w-0 max-w-md space-y-4 rounded-xl border p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <div className="min-w-0 space-y-4">
              <Skeleton className="h-3 w-40" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 3 }, (_, metric) => (
                  <div key={metric} className="space-y-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-8" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-11 w-44 md:h-8" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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

function latestFetchedAt(accounts: Account[]) {
  let latest: NonNullable<Account["statistics"]>["fetchedAt"] = null;
  for (const account of accounts) {
    const fetchedAt = account.statistics?.fetchedAt;
    if (!fetchedAt) continue;
    if (!latest || new Date(fetchedAt) > new Date(latest)) latest = fetchedAt;
  }
  return latest;
}

export function SocialPostStatistics(
  props: { projectId: string } | { workspaceId: string },
) {
  const projectId = "projectId" in props ? props.projectId : undefined;
  const workspaceId = "workspaceId" in props ? props.workspaceId : undefined;
  const scopeId = projectId ?? workspaceId ?? "";
  const statisticsPath = projectId
    ? `/api/projects/${encodeURIComponent(projectId)}/social-statistics`
    : `/api/workspaces/${encodeURIComponent(workspaceId ?? "")}/social-statistics`;
  const accountsHref = projectId
    ? `/social?projectId=${encodeURIComponent(projectId)}&tab=accounts`
    : "/social?tab=accounts";
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
    scopeId,
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
      const response = await fetch(`${statisticsPath}?${params}`, {
        signal,
        cache: "no-store",
      });
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
    refetchOnWindowFocus: true,
    refetchInterval: (current) =>
      socialSyncPollIntervalMs(current.state.data?.pages[0]?.accounts ?? []),
  });
  const accounts = query.data?.pages[0]?.accounts ?? [];
  const accountsById = new Map(
    accounts.map((account) => [account.id, account]),
  );
  const selectedAccount =
    accounts.find((account) => account.id === filters.statisticsAccount) ??
    null;
  const impressionBased = selectedAccount
    ? selectedAccount.provider === "x" ||
      selectedAccount.provider === "linkedin"
    : accounts.some(
        (account) =>
          account.provider === "x" || account.provider === "linkedin",
      );
  const headline = query.data?.pages[0]?.headline;
  const posts = validRange
    ? (query.data?.pages.flatMap((page) => page.posts) ?? [])
    : [];
  const consistency = query.data?.pages[0]?.consistency;
  const enqueueingRef = useRef(false);
  const mountedRef = useRef(false);
  const autoRequestedIdsRef = useRef(new Set<string>());
  const [enqueueingId, setEnqueueingId] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  useMountEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  });

  async function enqueueRefresh(
    targets: Account[],
    { silent = false }: { silent?: boolean } = {},
  ) {
    if (enqueueingRef.current || targets.length === 0) return;
    enqueueingRef.current = true;
    if (!silent) setSyncErrors({});
    try {
      for (const account of targets) {
        if (!silent) setEnqueueingId(account.id);
        try {
          if (!projectId) return;
          const result = await refreshProjectSocialAccountStatistics({
            projectId,
            connectionId: account.id,
          });
          if (!mountedRef.current) return;
          if (!result.ok && !silent) {
            setSyncErrors((errors) => ({
              ...errors,
              [account.id]: t("accountSyncFailed"),
            }));
          }
        } catch {
          if (mountedRef.current && !silent)
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

  function handleSync(targets: Account[]) {
    return enqueueRefresh(targets);
  }

  const autoRequestKey = accounts
    .filter((account) => account.sync?.mayAutoRequest)
    .map((account) => account.id)
    .toSorted()
    .join(",");
  useEffect(() => {
    if (!query.isSuccess) return;
    for (const account of accounts) {
      if (!account.sync?.mayAutoRequest)
        autoRequestedIdsRef.current.delete(account.id);
    }
    const stale = accounts.filter(
      (account) =>
        account.status === "active" &&
        account.sync?.mayAutoRequest &&
        !autoRequestedIdsRef.current.has(account.id),
    );
    if (stale.length === 0) return;
    for (const account of stale) autoRequestedIdsRef.current.add(account.id);
    void enqueueRefresh(stale, { silent: true });
  }, [autoRequestKey, query.isSuccess]);

  function exportHref(format: "csv" | "xlsx") {
    const params = new URLSearchParams({ format });
    if (filters.statisticsProvider)
      params.set("provider", filters.statisticsProvider);
    if (filters.statisticsAccount)
      params.set("connectionId", filters.statisticsAccount);
    if (typeof publishedFrom === "string")
      params.set("publishedFrom", `${publishedFrom}T00:00:00.000Z`);
    if (typeof publishedUntil === "string")
      params.set("publishedUntil", `${publishedUntil}T23:59:59.999Z`);
    return `${statisticsPath}/export?${params}`;
  }

  function formatUpdated(value: string | Date) {
    return formatter.relativeTime(new Date(value));
  }

  function isSyncInFlight(account: Account | undefined) {
    return (
      account?.sync?.status === "queued" || account?.sync?.status === "running"
    );
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
  const latestFetched = latestFetchedAt(
    selectedAccount ? [selectedAccount] : accounts,
  );
  const viewAccounts = selectedAccount ? [selectedAccount] : accounts;
  const updating =
    Boolean(enqueueingId) ||
    viewAccounts.some((account) => isSyncInFlight(account));

  const advancedFilterCount = [
    !preset && Boolean(filters.publishedFrom || filters.publishedUntil),
  ].filter(Boolean).length;

  return (
    <section
      className="space-y-6"
      data-testid="social-statistics"
      aria-label={t("title")}
    >
      {query.isPending ? (
        <PerformanceQuerySkeleton label={t("loading")} />
      ) : null}
      {query.isPending ? null : query.isError && !query.isFetchNextPageError ? (
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
          <Link className="underline underline-offset-4" href={accountsHref}>
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
                  className="text-foreground h-11 w-full sm:w-auto sm:min-w-[200px] md:h-10 data-[size=default]:h-11 md:data-[size=default]:h-10"
                >
                  <SelectValue />
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
                {updating ? (
                  <p>{t("updating")}</p>
                ) : latestFetched ? (
                  <p>
                    {t("updatedAt", {
                      date: formatUpdated(latestFetched),
                    })}
                  </p>
                ) : (
                  <p>{t("notFetched")}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {projectId ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-11 md:h-8"
                  variant="outline"
                  loading={Boolean(enqueueingId)}
                  disabled={
                    Boolean(enqueueingId) ||
                    (selectedAccount
                      ? selectedAccount.status !== "active"
                      : !accounts.some(
                          (account) => account.status === "active",
                        ))
                  }
                  onClick={() =>
                    void handleSync(
                      selectedAccount
                        ? [selectedAccount]
                        : accounts.filter(
                            (account) => account.status === "active",
                          ),
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
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    className="h-11 md:h-8"
                    variant="outline"
                    aria-label={t("performance.moreActions")}
                  >
                    <MoreVertical className="size-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(["csv", "xlsx"] as const).map((exportFormat) => {
                    const label = t(
                      exportFormat === "csv"
                        ? "performance.exportCsv"
                        : "performance.exportXlsx",
                    );
                    return validRange ? (
                      <DropdownMenuItem key={exportFormat} asChild>
                        <a href={exportHref(exportFormat)} download>
                          <Download className="size-4" aria-hidden />
                          {label}
                        </a>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem key={exportFormat} disabled>
                        <Download className="size-4" aria-hidden />
                        {label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {statusAccount?.status && statusAccount.status !== "active" ? (
            <p className="text-semantic-warning text-sm">
              {t("reconnectHint")}{" "}
              <Link
                className="underline underline-offset-4"
                href={accountsHref}
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
          {statusSnapshot?.historyError ? (
            <p role="status" className="text-semantic-warning text-sm">
              {t("historyLimited")}
            </p>
          ) : null}
        </section>
      ) : null}
      {query.isPending ? null : (
        <>
          <div className="flex flex-wrap gap-2">
            {(["7", "30", "90"] as const).map((days) => (
              <Button
                key={days}
                size="sm"
                type="button"
                className={
                  preset === days
                    ? "h-11 md:h-8"
                    : "text-foreground h-11 md:h-8"
                }
                variant={preset === days ? "default" : "outline"}
                aria-pressed={preset === days}
                onClick={() => handlePreset(days)}
              >
                {t("performance.lastDays", { days: Number(days) })}
              </Button>
            ))}
          </div>
          <details className="group">
            <summary className="text-muted-foreground flex w-fit cursor-pointer items-center gap-2 rounded-sm py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {t("performance.moreFilters")}
              {advancedFilterCount ? (
                <span className="text-foreground text-xs">
                  {t("performance.activeFilters", {
                    count: advancedFilterCount,
                  })}
                </span>
              ) : null}
            </summary>
            <div className="mt-4 flex flex-wrap items-end gap-3">
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
          </details>
          {!validRange ? (
            <p role="alert" className="text-semantic-destructive text-sm">
              {t("invalidRange")}
            </p>
          ) : null}
          {validRange && headline ? (
            <SocialPerformanceOverview
              headline={headline}
              impressionBased={impressionBased}
            />
          ) : null}
          {validRange && headline?.daily.length ? (
            <PerformanceTrendChart
              days={headline.daily}
              impressionBased={impressionBased}
            />
          ) : null}
          {validRange && consistency ? (
            <PostingConsistency
              days={consistency.daily.map((day) => ({
                date:
                  day.date instanceof Date
                    ? day.date.toISOString().slice(0, 10)
                    : day.date,
                posts: day.postCount,
                engagement: day.interactions,
              }))}
              selectedFrom={filters.publishedFrom}
              selectedUntil={filters.publishedUntil}
            />
          ) : null}
          <section className="space-y-4" aria-label={t("postsTitle")}>
            <h3 className="text-sm font-semibold">{t("postsTitle")}</h3>
            {!query.isPending &&
            !query.isError &&
            validRange &&
            posts.length === 0 ? (
              <EmptyState description={t("empty")} icon={BarChart2} />
            ) : null}
            <ul className="space-y-3">
              {posts.map((post) => (
                <SocialPublishedPost
                  key={post.id}
                  post={post}
                  account={accountsById.get(post.connectionId) ?? null}
                />
              ))}
            </ul>
            {query.hasNextPage && validRange ? (
              <div className="space-y-3">
                {query.isFetchNextPageError ? (
                  <p className="text-sm" role="alert">
                    {t("loadMoreError")}
                  </p>
                ) : null}
                <Button
                  variant="outline"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t("loadMore")}
                </Button>
              </div>
            ) : null}
          </section>
        </>
      )}
    </section>
  );
}
