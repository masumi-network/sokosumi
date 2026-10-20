"use client";

import type {
  SocialPerformanceAudienceResponse,
  SocialPerformanceBenchmarkResponse,
  SocialPerformanceContact,
  SocialPerformanceDiscoveryResponse,
  SocialStatisticsResearchPost,
} from "@sokosumi/core-client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SocialPostMetrics } from "./social-post-metrics";
import { SocialPostPreview } from "./social-post-preview";
import { PreviewAvatar } from "./social-post-preview-parts";

type Kind = SocialPerformanceAudienceResponse["kind"];
interface CachedPost {
  id: string;
  text: string | null;
}

interface ResearchPostProps {
  post: SocialStatisticsResearchPost;
  author: Pick<
    SocialPerformanceContact,
    "name" | "username" | "avatarUrl"
  > | null;
}

const POSTS_PER_BATCH = 6;

function ResearchQuerySkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy="true"
      className="space-y-6"
      data-testid="social-research-loading"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, card) => (
          <div key={card} className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function ResearchProfile({
  profile,
}: {
  profile: Pick<
    SocialPerformanceContact,
    "name" | "username" | "avatarUrl" | "followersCount"
  >;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  return (
    <div className="flex min-w-0 items-start gap-3 text-sm">
      <PreviewAvatar
        account={{
          handle: profile.username,
          displayName: profile.name,
          avatarUrl: profile.avatarUrl,
        }}
        name={profile.name || profile.username}
        className="size-8 shrink-0"
      />
      <div className="min-w-0 space-y-1">
        <p className="font-medium break-words">
          {profile.name || profile.username}
        </p>
        <p className="text-muted-foreground break-words">@{profile.username}</p>
        {profile.followersCount != null ? (
          <p className="text-muted-foreground tabular-nums">
            {t("research.followers", {
              count: format.number(profile.followersCount),
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ResearchPost({ post, author }: ResearchPostProps) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const postUrl =
    post.url ?? `https://x.com/i/status/${encodeURIComponent(post.externalId)}`;

  function handleSeeMore() {
    window.open(postUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <li className="flex h-full min-w-0 flex-col gap-2">
      <SocialPostPreview
        provider="x"
        compact
        account={{
          handle: author?.username ?? null,
          displayName:
            author?.name || author?.username || t("research.unknownAuthor"),
          avatarUrl: author?.avatarUrl ?? null,
        }}
        text={post.text}
        media={(post.media ?? []).map((media) => {
          const posterUrl = media.kind === "video" ? media.thumbnailUrl : null;
          return {
            kind: posterUrl ? "image" : media.kind,
            fileUrl: posterUrl ?? media.url,
            pathname: media.url,
            name: t(
              media.kind === "video" && !posterUrl
                ? "research.postVideo"
                : "research.postImage",
            ),
            size: 0,
            mimeType: "",
          };
        })}
        onSeeMore={handleSeeMore}
        timestamp={post.publishedAt ? new Date(post.publishedAt) : null}
      />
      <div className="mt-auto space-y-2">
        <SocialPostMetrics
          compact
          statistics={{
            metrics: post.metrics,
            fetchedAt: post.fetchedAt,
            refreshAttemptedAt: null,
            error: null,
          }}
        />
        <a
          className="inline-flex h-11 items-center text-sm underline underline-offset-4 md:h-8"
          href={postUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t("research.openOnX")}
        </a>
      </div>
    </li>
  );
}

function ResearchPostGrid({
  posts,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
}: {
  posts: ResearchPostProps[];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => Promise<unknown>;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const [visibleCount, setVisibleCount] = useState(POSTS_PER_BATCH);
  const shownCount = Math.min(visibleCount, posts.length);

  async function handleShowMore() {
    if (shownCount === posts.length && hasNextPage) await onLoadMore?.();
    setVisibleCount(shownCount + POSTS_PER_BATCH);
  }

  if (posts.length === 0 && !hasNextPage) return null;

  return (
    <div className="space-y-4">
      {posts.length ? (
        <ul className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {posts.slice(0, visibleCount).map((item) => (
            <ResearchPost key={item.post.id} {...item} />
          ))}
        </ul>
      ) : null}
      {shownCount < posts.length || hasNextPage ? (
        <Button
          type="button"
          size="sm"
          className="h-11 md:h-8"
          variant="outline"
          loading={isFetchingNextPage}
          onClick={() => void handleShowMore()}
        >
          {t("research.showMore")}
        </Button>
      ) : null}
    </div>
  );
}

function researchPostInteractions(post: SocialStatisticsResearchPost) {
  const quotes = post.additionalMetrics.find((metric) =>
    ["quote_count", "quotes"].includes(metric.key),
  )?.value;
  return (
    (post.metrics.likes ?? 0) +
    (post.metrics.comments ?? 0) +
    (post.metrics.shares ?? 0) +
    (quotes ?? 0)
  );
}

export function SocialStatisticsResearch({
  projectId,
  accountId,
  posts,
}: {
  projectId: string;
  accountId: string;
  posts: CachedPost[];
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const [panel, setPanel] = useState("audience");
  const [kind, setKind] = useState<Kind>("mentions");
  const [postId, setPostId] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [topic, setTopic] = useState("");
  const [audienceEnabled, setAudienceEnabled] = useState(false);
  const [benchmarkHandle, setBenchmarkHandle] = useState("");
  const [discoveryTopic, setDiscoveryTopic] = useState("");
  const needsPost = kind === "likers" || kind === "reposters";
  const audience = useInfiniteQuery({
    queryKey: [
      "social-statistics-audience",
      projectId,
      accountId,
      kind,
      postId,
    ],
    initialPageParam: undefined as string | undefined,
    enabled: audienceEnabled && (!needsPost || Boolean(postId)),
    queryFn: async ({
      pageParam,
      signal,
    }): Promise<SocialPerformanceAudienceResponse> => {
      const params = new URLSearchParams({ kind });
      if (postId) params.set("postId", postId);
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/social-statistics/${encodeURIComponent(accountId)}/audience?${params}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("research.loadFailed"));
      return response.json();
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const benchmark = useQuery({
    queryKey: [
      "social-statistics-benchmark",
      projectId,
      accountId,
      benchmarkHandle,
    ],
    enabled: Boolean(benchmarkHandle),
    queryFn: async ({
      signal,
    }): Promise<SocialPerformanceBenchmarkResponse> => {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/social-statistics/${encodeURIComponent(accountId)}/benchmark?username=${encodeURIComponent(benchmarkHandle)}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("research.loadFailed"));
      return response.json();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const discovery = useInfiniteQuery({
    queryKey: [
      "social-statistics-discovery",
      projectId,
      accountId,
      discoveryTopic,
    ],
    initialPageParam: undefined as string | undefined,
    enabled: Boolean(discoveryTopic),
    queryFn: async ({
      pageParam,
      signal,
    }): Promise<SocialPerformanceDiscoveryResponse> => {
      const params = new URLSearchParams({ topic: discoveryTopic });
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/social-statistics/${encodeURIComponent(accountId)}/discovery?${params}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("research.loadFailed"));
      return response.json();
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const audiencePages = audience.data?.pages ?? [];
  const contacts = audiencePages.flatMap((page) => page.contacts);
  const mentionPosts = audiencePages.flatMap((page) => page.posts ?? []);
  const discoveryPosts =
    discovery.data?.pages.flatMap((page) => page.posts) ?? [];
  const benchmarkPosts = [...(benchmark.data?.posts ?? [])].sort(
    (left, right) =>
      (right.metrics.impressions ?? -1) - (left.metrics.impressions ?? -1) ||
      researchPostInteractions(right) - researchPostInteractions(left),
  );

  return (
    <section
      className="space-y-4"
      data-testid="social-statistics-research"
      aria-label={t("research.title")}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("research.title")}</h3>
        <p className="text-muted-foreground text-sm">
          {t("research.description")}
        </p>
      </div>
      <Tabs value={panel} onValueChange={setPanel} className="gap-4">
        <TabsList className="h-auto w-full flex-wrap sm:w-auto sm:self-start">
          <TabsTrigger value="audience" className="h-11 px-3 md:h-8">
            {t("research.audience")}
          </TabsTrigger>
          <TabsTrigger value="benchmark" className="h-11 px-3 md:h-8">
            {t("research.compare")}
          </TabsTrigger>
          <TabsTrigger value="discovery" className="h-11 px-3 md:h-8">
            {t("research.discover")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="audience" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-2 sm:w-auto">
              <Label htmlFor="research-kind">{t("research.kind")}</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value as Kind);
                  setAudienceEnabled(false);
                }}
              >
                <SelectTrigger
                  id="research-kind"
                  className="text-foreground h-11 w-full sm:w-auto sm:min-w-[200px] md:h-10 data-[size=default]:h-11 md:data-[size=default]:h-10"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    ["mentions", "followers", "likers", "reposters"] as const
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`research.kinds.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsPost ? (
              <div className="w-full min-w-0 space-y-2 sm:w-auto sm:max-w-sm">
                <Label htmlFor="research-post">{t("research.post")}</Label>
                <Select
                  value={postId ?? ""}
                  onValueChange={(value) => {
                    setPostId(value);
                    setAudienceEnabled(false);
                  }}
                >
                  <SelectTrigger
                    id="research-post"
                    className="text-foreground h-11 w-full sm:w-auto sm:min-w-[200px] md:h-10 data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue placeholder={t("research.choosePost")} />
                  </SelectTrigger>
                  <SelectContent>
                    {posts.map((post) => (
                      <SelectItem key={post.id} value={post.id}>
                        {post.text?.slice(0, 48) || t("research.untitledPost")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-11 md:h-8"
              disabled={needsPost && !postId}
              loading={audience.isFetching && !audience.isFetchingNextPage}
              onClick={() => {
                if (audienceEnabled) void audience.refetch();
                else setAudienceEnabled(true);
              }}
            >
              {t("research.load")}
            </Button>
          </div>
          {audience.isLoading ? (
            <ResearchQuerySkeleton label={t("research.loading")} />
          ) : null}
          {audience.isError ? (
            <p role="alert" className="text-sm">
              {t("research.loadFailed")}
            </p>
          ) : null}
          {audiencePages[0]?.coverage ? (
            <p className="text-muted-foreground text-sm">
              {audiencePages[0].coverage}
            </p>
          ) : null}
          {audienceEnabled &&
          !audience.isPending &&
          !audience.isError &&
          contacts.length === 0 &&
          mentionPosts.length === 0 ? (
            <EmptyState description={t("research.empty")} icon={Users} />
          ) : null}
          {contacts.length ? (
            <ul className="space-y-3">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="space-y-2 rounded-lg border p-4"
                >
                  <ResearchProfile profile={contact} />
                  <dl className="ms-11 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {(
                      [
                        "interactions",
                        "replies",
                        "quotes",
                        "mentions",
                        "likes",
                        "reposts",
                      ] as const
                    ).map((key) =>
                      contact[key] != null ? (
                        <div key={key} className="flex gap-1">
                          <dt className="text-muted-foreground">
                            {t(`research.${key}`)}
                          </dt>
                          <dd className="font-medium tabular-nums">
                            {format.number(contact[key])}
                          </dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          ) : null}
          <ResearchPostGrid
            key={`${kind}:${postId}`}
            posts={mentionPosts}
            hasNextPage={kind === "mentions" && audience.hasNextPage}
            isFetchingNextPage={audience.isFetchingNextPage}
            onLoadMore={() => audience.fetchNextPage()}
          />
          {kind !== "mentions" && audience.hasNextPage ? (
            <Button
              type="button"
              size="sm"
              className="h-11 md:h-8"
              variant="outline"
              loading={audience.isFetchingNextPage}
              onClick={() => void audience.fetchNextPage()}
            >
              {t("research.loadMore")}
            </Button>
          ) : null}
        </TabsContent>
        <TabsContent value="benchmark" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-2 sm:w-auto sm:min-w-[200px]">
              <Label htmlFor="research-handle">{t("research.handle")}</Label>
              <Input
                id="research-handle"
                className="h-11 md:h-10"
                value={handle}
                maxLength={15}
                onChange={(event) => setHandle(event.target.value)}
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-11 md:h-8"
              disabled={!/^[A-Za-z0-9_]{1,15}$/.test(handle)}
              loading={benchmark.isFetching}
              onClick={() => {
                if (benchmarkHandle === handle) void benchmark.refetch();
                else setBenchmarkHandle(handle);
              }}
            >
              {t("research.load")}
            </Button>
          </div>
          {benchmark.isLoading ? (
            <ResearchQuerySkeleton label={t("research.loading")} />
          ) : null}
          {benchmark.isError ? (
            <p role="alert" className="text-sm">
              {t("research.loadFailed")}
            </p>
          ) : null}
          {benchmark.data ? (
            <div className="space-y-4">
              <ResearchProfile profile={benchmark.data.profile} />
              <p className="text-muted-foreground text-sm">
                {benchmark.data.coverage}
              </p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-4 xl:grid-cols-4 xl:gap-6">
                {(
                  [
                    ["posts", benchmark.data.summary.postCount],
                    ["views", benchmark.data.summary.views],
                    ["impressions", benchmark.data.summary.impressions],
                    ["interactions", benchmark.data.summary.interactions],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="flex min-w-0 flex-col">
                    <dt className="text-muted-foreground mb-1 text-sm">
                      {t(`research.${key}`)}
                    </dt>
                    <dd
                      className="text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-4xl"
                      title={
                        value == null
                          ? t("research.unavailable")
                          : format.number(value)
                      }
                    >
                      {value == null
                        ? "—"
                        : format.number(
                            value,
                            Math.abs(value) >= 10000
                              ? {
                                  notation: "compact",
                                  maximumFractionDigits: 1,
                                }
                              : { maximumFractionDigits: 2 },
                          )}
                    </dd>
                  </div>
                ))}
              </dl>
              {benchmark.data.posts.length === 0 ? (
                <EmptyState description={t("research.empty")} icon={Search} />
              ) : null}
              {benchmarkPosts.length ? (
                <h4 className="text-sm font-semibold">
                  {t("research.topPosts")}
                </h4>
              ) : null}
              <ResearchPostGrid
                key={benchmarkHandle}
                posts={benchmarkPosts.map((post) => ({
                  post,
                  author: benchmark.data?.profile ?? null,
                }))}
              />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="discovery" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-2 sm:w-auto sm:min-w-[200px]">
              <Label htmlFor="research-topic">{t("research.topic")}</Label>
              <Input
                id="research-topic"
                className="h-11 md:h-10"
                value={topic}
                maxLength={200}
                onChange={(event) => setTopic(event.target.value)}
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-11 md:h-8"
              disabled={!topic.trim()}
              loading={discovery.isFetching && !discovery.isFetchingNextPage}
              onClick={() => {
                if (discoveryTopic === topic.trim()) void discovery.refetch();
                else setDiscoveryTopic(topic.trim());
              }}
            >
              {t("research.load")}
            </Button>
          </div>
          {discovery.isLoading ? (
            <ResearchQuerySkeleton label={t("research.loading")} />
          ) : null}
          {discovery.isError ? (
            <p role="alert" className="text-sm">
              {t("research.loadFailed")}
            </p>
          ) : null}
          {discovery.data?.pages[0]?.coverage ? (
            <p className="text-muted-foreground text-sm">
              {discovery.data.pages[0].coverage}
            </p>
          ) : null}
          {discoveryTopic &&
          !discovery.isPending &&
          !discovery.isError &&
          discoveryPosts.length === 0 ? (
            <EmptyState description={t("research.empty")} icon={Search} />
          ) : null}
          <ResearchPostGrid
            key={discoveryTopic}
            posts={discoveryPosts}
            hasNextPage={discovery.hasNextPage}
            isFetchingNextPage={discovery.isFetchingNextPage}
            onLoadMore={() => discovery.fetchNextPage()}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
