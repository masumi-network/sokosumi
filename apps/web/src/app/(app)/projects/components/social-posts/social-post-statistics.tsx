"use client";

import type {
  SocialPerformanceResponse,
  WorkspaceSocialPerformanceResponse,
} from "@sokosumi/core-client";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useEffect, useRef, useState } from "react";
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
import { SocialPerformanceOverview } from "./social-performance-overview";
import { SocialPerformancePosts } from "./social-performance-posts";
import { SocialPerformanceResearch } from "./social-performance-research";
import { ACCOUNT_METRIC_LABELS } from "./social-post-metrics";

type StatisticsPage =
  | SocialPerformanceResponse
  | WorkspaceSocialPerformanceResponse;
type Account = StatisticsPage["accounts"][number];
type Metric = NonNullable<Account["statistics"]>["metrics"][number];

export function SocialPostStatistics({
  projectId,
  workspaceId,
}:
  | { projectId: string; workspaceId?: never }
  | { workspaceId: string; projectId?: never }) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useQueryStates({
    statisticsProvider: parseAsString,
    statisticsAccount: parseAsString,
    performanceProject: parseAsString,
    publishedFrom: parseAsString,
    publishedUntil: parseAsString,
    performanceRange: parseAsStringLiteral(["7", "30", "90"]),
    performanceTimezone: parseAsString.withDefault("UTC"),
    performanceSearch: parseAsString,
    performanceFormat: parseAsStringLiteral([
      "text",
      "image",
      "video",
      "carousel",
      "link",
      "unknown",
    ]),
    performancePostKind: parseAsStringLiteral([
      "posts",
      "replies",
      "quotes",
      "reposts",
      "all",
    ]).withDefault("posts"),
    performanceSort: parseAsStringLiteral([
      "publishedAt",
      "views",
      "impressions",
      "likes",
      "interactions",
      "engagementRate",
      "baselineMultiplier",
    ]).withDefault("interactions"),
  });
  const validRange =
    !filters.publishedFrom ||
    !filters.publishedUntil ||
    (filters.publishedFrom <= filters.publishedUntil &&
      new Date(filters.publishedUntil).getTime() -
        new Date(filters.publishedFrom).getTime() <
        366 * 86_400_000);
  const queryScope = [
    "social-performance",
    session?.user.id,
    session?.session.activeOrganizationId ?? null,
    projectId ? `project:${projectId}` : `workspace:${workspaceId}`,
  ];
  const ownerScope = projectId
    ? `project:${projectId}`
    : `workspace:${workspaceId}`;
  const runScopeKey = JSON.stringify(queryScope);
  const [filterScope, setFilterScope] = useState(ownerScope);
  const scopeChangePending = filterScope !== ownerScope;
  const apiPath = `/api/${projectId ? "projects" : "workspaces"}/${encodeURIComponent(projectId ?? workspaceId)}/social-performance`;
  const query = useInfiniteQuery({
    queryKey: [...queryScope, filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }): Promise<StatisticsPage> => {
      const params = new URLSearchParams();
      if (workspaceId && filters.performanceProject)
        params.set("projectId", filters.performanceProject);
      if (filters.statisticsProvider)
        params.set("provider", filters.statisticsProvider);
      if (filters.statisticsAccount)
        params.set("connectionId", filters.statisticsAccount);
      if (validRange && filters.publishedFrom)
        params.set("publishedFrom", `${filters.publishedFrom}T00:00:00.000Z`);
      if (validRange && filters.publishedUntil)
        params.set("publishedUntil", `${filters.publishedUntil}T23:59:59.999Z`);
      params.set("timezone", filters.performanceTimezone);
      params.set("postKind", filters.performancePostKind);
      params.set("sort", filters.performanceSort);
      if (filters.performanceSearch)
        params.set("search", filters.performanceSearch);
      if (filters.performanceFormat)
        params.set("contentType", filters.performanceFormat);
      if (pageParam) params.set("offset", String(pageParam));
      const response = await fetch(`${apiPath}?${params}`, {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(t("loadFailed"));
      const page: StatisticsPage = await response.json();
      if (
        !page ||
        !Array.isArray(page.accounts) ||
        !Array.isArray(page.posts) ||
        !page.summary ||
        !page.pagination
      ) {
        throw new Error(t("loadFailed"));
      }
      return page;
    },
    getNextPageParam: (page) => page.pagination.nextOffset ?? undefined,
    enabled: Boolean(session?.user.id) && !scopeChangePending,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const accounts = query.data?.pages[0]?.accounts ?? [];
  const firstPage = query.data?.pages[0];
  const projects =
    firstPage && "projects" in firstPage ? firstPage.projects : [];
  const projectNames = Object.fromEntries(
    projects.map((project) => [project.id, project.name]),
  );
  const connectionProjects = Object.fromEntries(
    projects.flatMap((project) =>
      project.connectionIds.map((id) => [id, project.id]),
    ),
  );
  const postProjects = Object.fromEntries(
    (query.data?.pages ?? []).flatMap((page) =>
      "workspaceId" in page
        ? page.posts.map((post) => [post.id, post.projectIds])
        : [],
    ),
  );
  function accountProjectId(accountId: string) {
    return projectId ?? connectionProjects[accountId];
  }
  function manageAccountsHref(accountId?: string) {
    const ownerProject = accountId ? accountProjectId(accountId) : projectId;
    return ownerProject
      ? `/social?projectId=${encodeURIComponent(ownerProject)}&tab=accounts`
      : "/social?tab=accounts";
  }
  const performance = firstPage
    ? {
        ...firstPage,
        posts: query.data?.pages.flatMap((page) => page.posts) ?? [],
      }
    : null;
  const performanceParams = new URLSearchParams({
    timezone: filters.performanceTimezone,
    postKind: filters.performancePostKind,
    sort: filters.performanceSort,
  });
  if (workspaceId && filters.performanceProject)
    performanceParams.set("projectId", filters.performanceProject);
  if (filters.statisticsProvider)
    performanceParams.set("provider", filters.statisticsProvider);
  if (filters.statisticsAccount)
    performanceParams.set("connectionId", filters.statisticsAccount);
  if (validRange && filters.publishedFrom)
    performanceParams.set(
      "publishedFrom",
      `${filters.publishedFrom}T00:00:00.000Z`,
    );
  if (validRange && filters.publishedUntil)
    performanceParams.set(
      "publishedUntil",
      `${filters.publishedUntil}T23:59:59.999Z`,
    );
  if (filters.performanceSearch)
    performanceParams.set("search", filters.performanceSearch);
  if (filters.performanceFormat)
    performanceParams.set("contentType", filters.performanceFormat);
  function handlePreset(days: "7" | "30" | "90") {
    const until = new Date();
    const from = new Date(
      Date.UTC(
        until.getUTCFullYear(),
        until.getUTCMonth(),
        until.getUTCDate() - Number(days) + 1,
      ),
    );
    void setFilters({
      performanceRange: days,
      publishedFrom: from.toISOString().slice(0, 10),
      publishedUntil: until.toISOString().slice(0, 10),
    });
  }
  const runRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const currentScopeRef = useRef(runScopeKey);
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
  useEffect(() => {
    if (currentScopeRef.current === runScopeKey) return;
    currentScopeRef.current = runScopeKey;
    runRef.current?.abort();
    runRef.current = null;
    setSync(null);
    setSyncErrors({});
  }, [runScopeKey]);
  useEffect(() => {
    if (!scopeChangePending) return;
    if (filters.performanceProject || filters.statisticsAccount) {
      void setFilters({ performanceProject: null, statisticsAccount: null });
      return;
    }
    setFilterScope(ownerScope);
  }, [
    scopeChangePending,
    ownerScope,
    filters.performanceProject,
    filters.statisticsAccount,
    setFilters,
  ]);

  async function handleSync(targets: Account[]) {
    if (runRef.current || targets.length === 0) return;
    const run = new AbortController();
    const runScope = runScopeKey;
    runRef.current = run;
    setSyncErrors({});
    let pages = 0;
    try {
      for (const [index, account] of targets.entries()) {
        if (run.signal.aborted) break;
        const ownerProjectId = accountProjectId(account.id);
        if (!ownerProjectId) continue;
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
              projectId: ownerProjectId,
              connectionId: account.id,
              continueHistory,
            });
            // A request already sent finishes on Core; cancellation prevents the next page.
            if (!mountedRef.current || currentScopeRef.current !== runScope)
              return;
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
            if (mountedRef.current && currentScopeRef.current === runScope)
              setSyncErrors((errors) => ({
                ...errors,
                [account.id]: t("accountSyncFailed"),
              }));
            break;
          }
        }
      }
    } finally {
      if (runRef.current === run) {
        runRef.current = null;
        if (mountedRef.current) setSync(null);
      }
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
        <h2 className="text-lg font-semibold">
          {t(workspaceId ? "performance.workspaceTitle" : "title")}
        </h2>
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

      <section
        className="space-y-4 rounded-xl border p-4"
        aria-label={t("performance.filters")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(["7", "30", "90"] as const).map((days) => (
              <Button
                key={days}
                size="sm"
                variant={
                  (filters.performanceRange ??
                    (!filters.publishedFrom && !filters.publishedUntil
                      ? "30"
                      : null)) === days
                    ? "default"
                    : "outline"
                }
                aria-pressed={
                  filters.performanceRange === days ||
                  (days === "30" &&
                    !filters.publishedFrom &&
                    !filters.publishedUntil)
                }
                onClick={() => handlePreset(days)}
              >
                {t("performance.lastDays", { days })}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["csv", "xlsx"] as const).map((exportFormat) => {
              const content = (
                <>
                  <Download className="size-4" aria-hidden />
                  {t(
                    exportFormat === "csv"
                      ? "performance.exportCsv"
                      : "performance.exportXlsx",
                  )}
                </>
              );
              return (
                <Button
                  key={exportFormat}
                  size="sm"
                  variant="outline"
                  asChild={validRange}
                  disabled={!validRange}
                >
                  {validRange ? (
                    <a
                      href={`${apiPath}/export?${performanceParams}&format=${exportFormat}`}
                    >
                      {content}
                    </a>
                  ) : (
                    content
                  )}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {workspaceId ? (
            <div className="space-y-2">
              <Label htmlFor="performance-project">
                {t("performance.project")}
              </Label>
              <Select
                value={filters.performanceProject ?? "all"}
                onValueChange={(value) =>
                  void setFilters({
                    performanceProject: value === "all" ? null : value,
                    statisticsAccount: null,
                  })
                }
              >
                <SelectTrigger id="performance-project" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("performance.allProjects")}
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
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
              value={filters.publishedUntil ?? ""}
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

          <div className="space-y-2">
            <Label htmlFor="performance-timezone">
              {t("performance.timezone")}
            </Label>
            <Select
              value={filters.performanceTimezone}
              onValueChange={(value) =>
                void setFilters({ performanceTimezone: value })
              }
            >
              <SelectTrigger
                id="performance-timezone"
                className="w-full sm:w-52"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["UTC", ...Intl.supportedValuesOf("timeZone")].map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void setFilters({
                statisticsProvider: null,
                performanceProject: null,
                statisticsAccount: null,
                publishedFrom: null,
                publishedUntil: null,
                performanceRange: null,
                performanceSearch: null,
                performanceFormat: null,
                performancePostKind: null,
                performanceSort: null,
              })
            }
          >
            {t("clearFilters")}
          </Button>
        </div>

        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="performance-search">
              {t("performance.searchPosts")}
            </Label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute start-3 top-3 size-4"
                aria-hidden
              />
              <Input
                id="performance-search"
                className="ps-9"
                value={filters.performanceSearch ?? ""}
                maxLength={200}
                onChange={(event) =>
                  void setFilters({
                    performanceSearch: event.target.value || null,
                  })
                }
                placeholder={t("performance.searchPlaceholder")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="performance-format">
              {t("performance.contentType")}
            </Label>
            <Select
              value={filters.performanceFormat ?? "all"}
              onValueChange={(value) =>
                void setFilters({
                  performanceFormat:
                    value === "all"
                      ? null
                      : (value as NonNullable<
                          typeof filters.performanceFormat
                        >),
                })
              }
            >
              <SelectTrigger id="performance-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("performance.allFormats")}
                </SelectItem>
                {(
                  [
                    "text",
                    "image",
                    "video",
                    "carousel",
                    "link",
                    "unknown",
                  ] as const
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`performance.formats.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="performance-kind">
              {t("performance.postKind")}
            </Label>
            <Select
              value={filters.performancePostKind}
              onValueChange={(value) =>
                void setFilters({
                  performancePostKind:
                    value as typeof filters.performancePostKind,
                })
              }
            >
              <SelectTrigger id="performance-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["posts", "replies", "quotes", "reposts", "all"] as const
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`performance.kinds.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="performance-sort">{t("performance.sort")}</Label>
            <Select
              value={filters.performanceSort}
              onValueChange={(value) =>
                void setFilters({
                  performanceSort: value as typeof filters.performanceSort,
                })
              }
            >
              <SelectTrigger id="performance-sort" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "interactions",
                    "publishedAt",
                    "views",
                    "impressions",
                    "likes",
                    "engagementRate",
                    "baselineMultiplier",
                  ] as const
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`performance.sorts.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>
      {!validRange ? (
        <p role="alert" className="text-semantic-destructive text-sm">
          {t("performance.invalidRange")}
        </p>
      ) : null}
      {performance && validRange ? (
        <>
          {firstPage && "workspaceId" in firstPage ? (
            <p className="text-muted-foreground text-xs">
              {t("performance.workspaceDedupHint", {
                count: firstPage.coverage.duplicatePostCopiesExcluded,
              })}
            </p>
          ) : null}
          <SocialPerformanceOverview
            data={performance}
            projects={projects}
            projectComparisons={
              firstPage && "workspaceId" in firstPage
                ? firstPage.comparisons.projects
                : undefined
            }
          />
          <SocialPerformancePosts
            key={`posts:${runScopeKey}`}
            data={performance}
            projectNames={projectNames}
            postProjects={postProjects}
          />
          <SocialPerformanceResearch
            key={`research:${runScopeKey}`}
            projectId={projectId}
            workspaceId={workspaceId}
            connectionProjects={connectionProjects}
            projectNames={projectNames}
            data={performance}
            filterContext={JSON.stringify(
              Object.fromEntries(performanceParams),
            )}
          />
          {query.hasNextPage ? (
            <Button
              variant="outline"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("loadMore")}
            </Button>
          ) : null}
        </>
      ) : null}
      <section className="space-y-3" aria-label={t("accountsTitle")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t("accountsTitle")}</h3>
          <Button
            type="button"
            variant="outline"
            disabled={
              Boolean(sync) ||
              !accounts.some(
                (account) =>
                  account.status === "active" && accountProjectId(account.id),
              )
            }
            onClick={() =>
              void handleSync(
                accounts.filter(
                  (account) =>
                    account.status === "active" && accountProjectId(account.id),
                ),
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
              href={manageAccountsHref()}
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
                    {workspaceId ? (
                      <p className="text-muted-foreground text-xs">
                        {
                          projects.find(
                            (project) =>
                              project.id === accountProjectId(account.id),
                          )?.name
                        }
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={sync?.accountId === account.id && !sync.stopping}
                    disabled={
                      Boolean(sync) ||
                      account.status !== "active" ||
                      !accountProjectId(account.id)
                    }
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
                      href={manageAccountsHref(account.id)}
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
    </div>
  );
}
