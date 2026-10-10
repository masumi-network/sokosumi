"use client";

import type {
  SocialPerformanceResponse,
  WorkspaceSocialPerformanceResponse,
} from "@sokosumi/core-client";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Download, MoreVertical, Search } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useEffect, useRef, useState } from "react";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { refreshProjectSocialAccountStatistics } from "@/lib/actions/project/action";
import { useSession } from "@/lib/auth/auth.client";
import { SocialPerformanceOverview } from "./social-performance-overview";
import { SocialPerformancePosts } from "./social-performance-posts";
import { SocialPerformanceResearch } from "./social-performance-research";

type StatisticsPage =
  | SocialPerformanceResponse
  | WorkspaceSocialPerformanceResponse;
type Account = StatisticsPage["accounts"][number];

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
  const [filterScope, setFilterScope] = useState(ownerScope);
  const scopeChangePending = filterScope !== ownerScope;
  const apiPath = `/api/${projectId ? "projects" : "workspaces"}/${encodeURIComponent(projectId ?? workspaceId)}/social-performance`;
  const catalogue = useQuery({
    queryKey: [...queryScope, "catalogue"],
    queryFn: async ({ signal }): Promise<StatisticsPage> => {
      const response = await fetch(`${apiPath}?limit=1`, {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(t("loadFailed"));
      const page: StatisticsPage = await response.json();
      if (
        !Array.isArray(page?.accounts) ||
        (workspaceId &&
          !Array.isArray("projects" in page ? page.projects : null))
      )
        throw new Error(t("loadFailed"));
      return page;
    },
    enabled: Boolean(session?.user.id) && !scopeChangePending,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const accounts = catalogue.data?.accounts ?? [];
  const projects =
    catalogue.data && "projects" in catalogue.data
      ? catalogue.data.projects
      : [];
  const projectNames = Object.fromEntries(
    projects.map((project) => [project.id, project.name]),
  );
  const connectionProjects = Object.fromEntries(
    projects.flatMap((project) =>
      project.connectionIds.map((id) => [id, project.id]),
    ),
  );
  function accountProjectId(accountId: string) {
    return projectId ?? connectionProjects[accountId];
  }
  const eligibleAccounts = accounts.filter((account) =>
    Boolean(accountProjectId(account.id)),
  );
  const fallbackAccounts = filters.statisticsProvider
    ? eligibleAccounts.filter(
        (account) => account.provider === filters.statisticsProvider,
      )
    : eligibleAccounts;
  const selectedAccount =
    eligibleAccounts.find(
      (account) => account.id === filters.statisticsAccount,
    ) ??
    fallbackAccounts.find((account) => account.status === "active") ??
    fallbackAccounts[0] ??
    eligibleAccounts.find((account) => account.status === "active") ??
    eligibleAccounts[0];
  const selectedProjectId = selectedAccount
    ? accountProjectId(selectedAccount.id)
    : undefined;
  const runScopeKey = JSON.stringify([
    ...queryScope,
    selectedAccount?.id ?? null,
  ]);
  const {
    statisticsAccount: _account,
    statisticsProvider: _provider,
    performanceProject: _project,
    ...postFilters
  } = filters;
  const query = useInfiniteQuery({
    queryKey: [...queryScope, "account", selectedAccount?.id, postFilters],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }): Promise<StatisticsPage> => {
      const params = new URLSearchParams();
      if (workspaceId && selectedProjectId)
        params.set("projectId", selectedProjectId);
      if (selectedAccount) {
        params.set("provider", selectedAccount.provider);
        params.set("connectionId", selectedAccount.id);
      }
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
    enabled:
      Boolean(session?.user.id && selectedAccount && selectedProjectId) &&
      !scopeChangePending,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const firstPage = query.data?.pages[0];
  const postProjects = Object.fromEntries(
    (query.data?.pages ?? []).flatMap((page) =>
      "workspaceId" in page
        ? page.posts.map((post) => [post.id, post.projectIds])
        : [],
    ),
  );
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
  if (workspaceId && selectedProjectId)
    performanceParams.set("projectId", selectedProjectId);
  if (selectedAccount) {
    performanceParams.set("provider", selectedAccount.provider);
    performanceParams.set("connectionId", selectedAccount.id);
  }
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
  useEffect(() => {
    if (scopeChangePending || !selectedAccount) return;
    if (
      filters.statisticsAccount !== selectedAccount.id ||
      filters.statisticsProvider ||
      filters.performanceProject
    ) {
      void setFilters({
        statisticsAccount: selectedAccount.id,
        statisticsProvider: null,
        performanceProject: null,
      });
    }
  }, [
    scopeChangePending,
    selectedAccount,
    filters.statisticsAccount,
    filters.statisticsProvider,
    filters.performanceProject,
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
              { queryKey: [...queryScope, "account"] },
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
            queryClient.setQueryData<StatisticsPage>(
              [...queryScope, "catalogue"],
              (current) =>
                current
                  ? {
                      ...current,
                      accounts: current.accounts.map((cached) =>
                        cached.id === result.value.account.id
                          ? result.value.account
                          : cached,
                      ),
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

  function formatDate(value: string | Date) {
    return formatter.dateTime(new Date(value), "dateTime", {
      timeZone: "UTC",
      timeZoneName: "short",
    });
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
  const advancedFilterCount = [
    !filters.performanceRange &&
      Boolean(filters.publishedFrom || filters.publishedUntil),
    filters.performanceTimezone !== "UTC",
    Boolean(filters.performanceSearch),
    Boolean(filters.performanceFormat),
    filters.performancePostKind !== "posts",
    filters.performanceSort !== "interactions",
  ].filter(Boolean).length;

  return (
    <div className="space-y-6" data-testid="social-statistics">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("performance.accountDescription")}
        </p>
      </div>
      <div role="status" className="text-muted-foreground text-sm">
        {catalogue.isPending || (selectedAccount && query.isPending)
          ? t("loading")
          : ""}
      </div>
      {catalogue.isError || query.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm">{t("loadFailed")}</p>
          <Button
            variant="outline"
            loading={catalogue.isFetching || query.isFetching}
            onClick={() =>
              void (catalogue.isError ? catalogue.refetch() : query.refetch())
            }
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {!catalogue.isPending &&
      !catalogue.isError &&
      !eligibleAccounts.length ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
          {t("noAccounts")}{" "}
          <Link
            className="underline underline-offset-4"
            href={manageAccountsHref()}
          >
            {t("manageAccounts")}
          </Link>
        </p>
      ) : null}
      <Tabs
        value={selectedAccount?.id ?? ""}
        onValueChange={(value) => {
          if (!eligibleAccounts.some((account) => account.id === value)) return;
          void setFilters({
            statisticsAccount: value,
            statisticsProvider: null,
            performanceProject: null,
          });
        }}
        className="min-w-0 space-y-6"
      >
        <TabsContent
          key={runScopeKey}
          value={selectedAccount?.id ?? "none"}
          className="min-w-0 space-y-6"
        >
          {/* Unified header: account selection, identity, freshness, and actions */}
          {selectedAccount ? (
            <section className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                {/* Account selector + identity */}
                <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
                  {eligibleAccounts.length > 1 ? (
                    <Select
                      value={selectedAccount.id}
                      onValueChange={(value) => {
                        if (
                          !eligibleAccounts.some(
                            (account) => account.id === value,
                          )
                        )
                          return;
                        void setFilters({
                          statisticsAccount: value,
                          statisticsProvider: null,
                          performanceProject: null,
                        });
                      }}
                    >
                      <SelectTrigger
                        aria-label={t("performance.accountTabs")}
                        className="text-foreground w-full sm:w-auto sm:min-w-[200px]"
                      >
                        <div className="flex items-center gap-2">
                          <SocialPostProviderIcon
                            provider={selectedAccount.provider}
                            className="text-foreground size-4 shrink-0"
                            aria-hidden
                          />
                          <SelectValue>
                            {accountName(selectedAccount)}
                          </SelectValue>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleAccounts.map((account) => {
                          const duplicate =
                            workspaceId &&
                            eligibleAccounts.some(
                              (other) =>
                                other.id !== account.id &&
                                other.provider === account.provider &&
                                (other.externalHandle ?? other.displayName) ===
                                  (account.externalHandle ??
                                    account.displayName),
                            );
                          const subtitle =
                            (SOCIAL_PROVIDERS.find(
                              (provider) => provider.id === account.provider,
                            )?.name ?? account.provider) +
                            (duplicate
                              ? ` · ${projectNames[accountProjectId(account.id)] ?? ""}`
                              : "");
                          return (
                            <SelectItem key={account.id} value={account.id}>
                              <div className="flex items-center gap-2">
                                <SocialPostProviderIcon
                                  provider={account.provider}
                                  className="size-4 shrink-0"
                                  aria-hidden
                                />
                                <div className="min-w-0">
                                  <div className="truncate">
                                    {accountName(account)}
                                  </div>
                                  <div className="text-muted-foreground truncate text-xs">
                                    {subtitle}
                                  </div>
                                </div>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2">
                      <SocialPostProviderIcon
                        provider={selectedAccount.provider}
                        className="size-5 shrink-0"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <div className="font-medium">
                          {accountName(selectedAccount)}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Account identity and freshness */}
                  <div className="text-muted-foreground min-w-0 space-y-0.5 text-sm">
                    {selectedAccount.externalHandle ? (
                      <p className="truncate">
                        {selectedAccount.externalHandle}
                      </p>
                    ) : null}
                    {(() => {
                      const snapshot =
                        firstPage?.accounts.find(
                          (account) => account.id === selectedAccount.id,
                        )?.statistics ?? selectedAccount.statistics;
                      return snapshot?.fetchedAt ? (
                        <p className="truncate">
                          {t("updatedAt", {
                            date: formatDate(snapshot.fetchedAt),
                          })}
                        </p>
                      ) : (
                        <p>{t("notFetched")}</p>
                      );
                    })()}
                    {workspaceId ? (
                      <p className="truncate">
                        {
                          projects.find(
                            (project) =>
                              project.id ===
                              accountProjectId(selectedAccount.id),
                          )?.name
                        }
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Actions: Sync and Export menu */}
                <div className="flex items-center gap-2">
                  {sync ? (
                    <>
                      <span className="text-muted-foreground text-sm">
                        {t(sync.stopping ? "stoppingSync" : "syncProgress", {
                          completed: sync.completed,
                          total: sync.total,
                          pages: sync.pages,
                        })}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={sync.stopping}
                        onClick={handleCancel}
                      >
                        {t("stopSync")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          selectedAccount.status !== "active" ||
                          !accountProjectId(selectedAccount.id)
                        }
                        onClick={() => void handleSync([selectedAccount])}
                      >
                        {(() => {
                          const snapshot =
                            firstPage?.accounts.find(
                              (account) => account.id === selectedAccount.id,
                            )?.statistics ?? selectedAccount.statistics;
                          return snapshot?.historyNextCursor &&
                            !snapshot.historyComplete
                            ? t("resumeSync")
                            : t("syncAccount");
                        })()}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
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
                                <a
                                  href={`${apiPath}/export?${performanceParams}&format=${exportFormat}`}
                                >
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
                    </>
                  )}
                </div>
              </div>

              {/* Status warnings */}
              {selectedAccount.status !== "active" ? (
                <p className="text-semantic-warning text-sm">
                  {t("reconnectHint")}{" "}
                  <Link
                    className="underline underline-offset-4"
                    href={manageAccountsHref(selectedAccount.id)}
                  >
                    {t("manageAccounts")}
                  </Link>
                </p>
              ) : null}
              {(() => {
                const snapshot =
                  firstPage?.accounts.find(
                    (account) => account.id === selectedAccount.id,
                  )?.statistics ?? selectedAccount.statistics;
                return (
                  <>
                    {snapshot?.error || syncErrors[selectedAccount.id] ? (
                      <p
                        role="status"
                        className="text-semantic-warning text-sm"
                      >
                        {syncErrors[selectedAccount.id] ??
                          t("accountMetricsIncomplete")}
                      </p>
                    ) : null}
                    {snapshot?.metricWarning ? (
                      <p
                        role="status"
                        className="text-semantic-warning text-sm"
                      >
                        {t("postMetricsIncomplete")}
                      </p>
                    ) : null}
                    {snapshot?.historyError ? (
                      <p
                        role="status"
                        className="text-semantic-warning text-sm"
                      >
                        {t("historyLimited")}
                      </p>
                    ) : snapshot?.historyComplete ? (
                      <p className="text-muted-foreground text-xs">
                        {t("historyComplete")}
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </section>
          ) : null}

          {/* Date range controls (simple, no border) */}
          <div className="flex flex-wrap gap-2">
            {(["7", "30", "90"] as const).map((days) => {
              const active =
                (filters.performanceRange ??
                  (!filters.publishedFrom && !filters.publishedUntil
                    ? "30"
                    : null)) === days;
              return (
                <Button
                  key={days}
                  size="sm"
                  className={active ? undefined : "text-foreground"}
                  variant={active ? "default" : "outline"}
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
              );
            })}
          </div>

          {/* Advanced filters disclosure */}
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
                    {["UTC", ...Intl.supportedValuesOf("timeZone")].map(
                      (zone) => (
                        <SelectItem key={zone} value={zone}>
                          {zone.replaceAll("_", " ")}
                        </SelectItem>
                      ),
                    )}
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
                    publishedFrom: null,
                    publishedUntil: null,
                    performanceRange: null,
                    performanceTimezone: "UTC",
                    performanceSearch: null,
                    performanceFormat: null,
                    performancePostKind: "posts",
                    performanceSort: "interactions",
                  })
                }
              >
                {t("clearFilters")}
              </Button>
            </div>
            <div className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                <Label htmlFor="performance-sort">
                  {t("performance.sort")}
                </Label>
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
          </details>

          {!validRange ? (
            <p role="alert" className="text-semantic-destructive text-sm">
              {t("performance.invalidRange")}
            </p>
          ) : null}
          {performance && validRange ? (
            <>
              <SocialPerformanceOverview
                key={`overview:${runScopeKey}`}
                data={performance}
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
