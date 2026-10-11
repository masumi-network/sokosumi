"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Kind = "followers" | "mentions" | "likers" | "reposters";
type CachedPost = { id: string; text: string | null };
type Contact = {
  id: string;
  name: string;
  username: string;
  followersCount: number | null;
};
type PublicPost = {
  author: Contact | null;
  post: { id: string; text: string | null; url: string | null };
};
type AudiencePage = {
  contacts: Contact[];
  posts: PublicPost[];
  nextCursor: string | null;
  coverage: string;
};
type Benchmark = {
  profile: { name: string; username: string; followersCount: number | null };
  summary: {
    postCount: number;
    views: number | null;
    impressions: number | null;
    interactions: number | null;
  };
  posts: Array<{ id: string; text: string | null; url: string | null }>;
  coverage: string;
};
type DiscoveryPage = {
  posts: PublicPost[];
  nextCursor: string | null;
  coverage: string;
};

function XHandle({
  name,
  username,
}: {
  name?: string | null;
  username: string;
}) {
  return (
    <p className="flex min-w-0 items-center gap-2 font-medium">
      <SocialPostProviderIcon
        provider="x"
        className="size-4 shrink-0"
        aria-hidden
      />
      <span className="min-w-0 truncate">
        {name ? `${name} ` : null}
        <span className="text-muted-foreground">@{username}</span>
      </span>
    </p>
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
    queryFn: async ({ pageParam, signal }): Promise<AudiencePage> => {
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
    queryFn: async ({ signal }): Promise<Benchmark> => {
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
    queryFn: async ({ pageParam, signal }): Promise<DiscoveryPage> => {
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
  const mentionPosts = audiencePages.flatMap((page) => page.posts);
  const discoveryPosts =
    discovery.data?.pages.flatMap((page) => page.posts) ?? [];

  return (
    <section
      className="space-y-4"
      data-testid="social-statistics-research"
      aria-label={t("research.title")}
    >
      <h3 className="text-sm font-semibold">{t("research.title")}</h3>
      <Tabs value={panel} onValueChange={setPanel}>
        <TabsList>
          <TabsTrigger value="audience">{t("research.audience")}</TabsTrigger>
          <TabsTrigger value="benchmark">{t("research.compare")}</TabsTrigger>
          <TabsTrigger value="discovery">{t("research.discover")}</TabsTrigger>
        </TabsList>
        <TabsContent value="audience" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="research-kind">{t("research.kind")}</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value as Kind);
                  setAudienceEnabled(false);
                }}
              >
                <SelectTrigger id="research-kind" className="w-[180px]">
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
              <div className="space-y-2">
                <Label htmlFor="research-post">{t("research.post")}</Label>
                <Select
                  value={postId ?? ""}
                  onValueChange={(value) => {
                    setPostId(value);
                    setAudienceEnabled(false);
                  }}
                >
                  <SelectTrigger id="research-post" className="w-[220px]">
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
              disabled={needsPost && !postId}
              loading={audience.isFetching && !audience.isFetchingNextPage}
              onClick={() => setAudienceEnabled(true)}
            >
              {t("research.load")}
            </Button>
          </div>
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
            <p className="text-muted-foreground text-sm">
              {t("research.empty")}
            </p>
          ) : null}
          {contacts.length ? (
            <ul className="space-y-2">
              {contacts.map((contact) => (
                <li key={contact.id} className="rounded-lg border p-3 text-sm">
                  <XHandle name={contact.name} username={contact.username} />
                  {contact.followersCount != null ? (
                    <p className="text-muted-foreground">
                      {t("research.followers", {
                        count: format.number(contact.followersCount),
                      })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {mentionPosts.length ? (
            <ul className="space-y-2">
              {mentionPosts.map((item) => (
                <li
                  key={item.post.id}
                  className="rounded-lg border p-3 text-sm whitespace-pre-wrap break-words"
                >
                  {item.author ? (
                    <div className="mb-1">
                      <XHandle
                        name={item.author.name}
                        username={item.author.username}
                      />
                    </div>
                  ) : null}
                  {item.post.text}
                </li>
              ))}
            </ul>
          ) : null}
          {audience.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              loading={audience.isFetchingNextPage}
              onClick={() => void audience.fetchNextPage()}
            >
              {t("research.loadMore")}
            </Button>
          ) : null}
        </TabsContent>
        <TabsContent value="benchmark" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="research-handle">{t("research.handle")}</Label>
              <Input
                id="research-handle"
                value={handle}
                maxLength={15}
                onChange={(event) => setHandle(event.target.value)}
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!/^[A-Za-z0-9_]{1,15}$/.test(handle)}
              loading={benchmark.isFetching}
              onClick={() => setBenchmarkHandle(handle)}
            >
              {t("research.load")}
            </Button>
          </div>
          {benchmark.isError ? (
            <p role="alert" className="text-sm">
              {t("research.loadFailed")}
            </p>
          ) : null}
          {benchmark.data ? (
            <div className="space-y-3">
              <XHandle
                name={benchmark.data.profile.name}
                username={benchmark.data.profile.username}
              />
              {benchmark.data.profile.followersCount != null ? (
                <p className="text-muted-foreground text-sm">
                  {t("research.followers", {
                    count: format.number(benchmark.data.profile.followersCount),
                  })}
                </p>
              ) : null}
              <p className="text-muted-foreground text-sm">
                {benchmark.data.coverage}
              </p>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {(
                  [
                    ["posts", benchmark.data.summary.postCount],
                    ["views", benchmark.data.summary.views],
                    ["impressions", benchmark.data.summary.impressions],
                    ["interactions", benchmark.data.summary.interactions],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-muted-foreground">
                      {t(`research.${key}`)}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {value == null
                        ? t("research.unavailable")
                        : format.number(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <ul className="space-y-2">
                {benchmark.data.posts.map((post) => (
                  <li
                    key={post.id}
                    className="rounded-lg border p-3 text-sm whitespace-pre-wrap break-words"
                  >
                    {post.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="discovery" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="research-topic">{t("research.topic")}</Label>
              <Input
                id="research-topic"
                value={topic}
                maxLength={200}
                onChange={(event) => setTopic(event.target.value)}
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!topic.trim()}
              loading={discovery.isFetching && !discovery.isFetchingNextPage}
              onClick={() => setDiscoveryTopic(topic.trim())}
            >
              {t("research.load")}
            </Button>
          </div>
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
            <p className="text-muted-foreground text-sm">
              {t("research.empty")}
            </p>
          ) : null}
          <ul className="space-y-2">
            {discoveryPosts.map((item) => (
              <li
                key={item.post.id}
                className="rounded-lg border p-3 text-sm whitespace-pre-wrap break-words"
              >
                {item.author ? (
                  <div className="mb-1">
                    <XHandle
                      name={item.author.name}
                      username={item.author.username}
                    />
                  </div>
                ) : null}
                {item.post.text}
              </li>
            ))}
          </ul>
          {discovery.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              loading={discovery.isFetchingNextPage}
              onClick={() => void discovery.fetchNextPage()}
            >
              {t("research.loadMore")}
            </Button>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
