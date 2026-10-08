"use client";

import type { SocialPost } from "@sokosumi/core-client";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
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
import { refreshProjectSocialPostStatistics } from "@/lib/actions/project/action";
import { useSession } from "@/lib/auth/auth.client";
import type { projectService } from "@/lib/services/project.service";
import { SOCIAL_METRIC_KEYS, SocialPostMetrics } from "./social-post-metrics";

type StatisticsPage = Awaited<
  ReturnType<typeof projectService.listSocialPostStatistics>
>;

export function SocialPostStatistics({ projectId }: { projectId: string }) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useQueryStates({
    statisticsProvider: parseAsString,
    publishedFrom: parseAsString,
    publishedUntil: parseAsString,
  });
  const validRange =
    !filters.publishedFrom ||
    !filters.publishedUntil ||
    filters.publishedFrom <= filters.publishedUntil;
  const queryKey = [
    "social-statistics",
    session?.user.id,
    session?.session.activeOrganizationId ?? null,
    projectId,
    filters,
  ];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<StatisticsPage> => {
      const params = new URLSearchParams();
      if (filters.statisticsProvider)
        params.set("provider", filters.statisticsProvider);
      if (filters.publishedFrom)
        params.set("publishedFrom", `${filters.publishedFrom}T00:00:00.000Z`);
      if (filters.publishedUntil)
        params.set("publishedUntil", `${filters.publishedUntil}T23:59:59.999Z`);
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/social-statistics?${params}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("loadFailed"));
      return response.json();
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(session?.user.id) && validRange,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const refresh = useMutation({
    mutationFn: async (post: SocialPost) => {
      const result = await refreshProjectSocialPostStatistics({
        projectId,
        postId: post.id,
      });
      if (!result.ok)
        throw new Error(result.error.message ?? t("refreshFailed"));
      return result.value;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["social-statistics"] });
    },
  });
  const posts = query.data?.pages.flatMap((page) => page.posts) ?? [];
  const summary = query.data?.pages[0]?.summary ?? [];
  return (
    <div className="space-y-6" data-testid="social-statistics">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="statistics-provider">{t("platform")}</Label>
          <Select
            value={filters.statisticsProvider ?? "all"}
            onValueChange={(value) =>
              void setFilters({
                statisticsProvider: value === "all" ? null : value,
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
      <div role="status" className="text-muted-foreground text-sm">
        {query.isPending && validRange ? t("loading") : ""}
      </div>
      {query.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm">{t("loadFailed")}</p>
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            loading={query.isFetching}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {refresh.isError ? (
        <p role="alert" className="text-semantic-warning text-sm">
          {t("refreshFailed")}
        </p>
      ) : null}
      {summary.length > 0 ? (
        <section className="space-y-3" aria-label={t("summary")}>
          <h3 className="text-sm font-semibold">{t("summary")}</h3>
          {summary.map((group) => (
            <div
              key={group.provider}
              className="space-y-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="font-medium">
                  {SOCIAL_PROVIDERS.find(
                    (provider) => provider.id === group.provider,
                  )?.name ?? group.provider}
                </h4>
                <p className="text-muted-foreground text-xs">
                  {t("coverage", {
                    measured: group.measuredPostCount,
                    total: group.postCount,
                  })}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                {SOCIAL_METRIC_KEYS.map((key) => (
                  <div key={key}>
                    <dt className="text-muted-foreground">
                      {t(`metrics.${key}`)}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {group.metrics[key] == null
                        ? t("unavailable")
                        : formatter.number(group.metrics[key])}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/social?projectId=${encodeURIComponent(projectId)}&postId=${encodeURIComponent(post.id)}&tab=statistics`}
                >
                  {SOCIAL_PROVIDERS.find(
                    (provider) => provider.id === post.provider,
                  )?.name ?? post.provider}
                </Link>
                <p className="text-muted-foreground text-xs">
                  {post.publishedAt
                    ? formatter.dateTime(
                        new Date(post.publishedAt),
                        "dateTime",
                        { timeZone: "UTC", timeZoneName: "short" },
                      )
                    : null}
                </p>
                <p className="line-clamp-3 text-sm whitespace-pre-wrap break-words">
                  {post.text}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={refresh.isPending}
                loading={refresh.isPending && refresh.variables?.id === post.id}
                onClick={() => refresh.mutate(post)}
              >
                {t("refresh")}
              </Button>
            </div>
            <SocialPostMetrics statistics={post.statistics} />
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
