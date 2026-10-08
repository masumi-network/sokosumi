"use client";

import type {
  SocialPerformanceAudienceResponse,
  SocialPerformanceBenchmarkResponse,
  SocialPerformanceResponse,
} from "@sokosumi/core-client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useClipboard } from "@/hooks/use-clipboard";
import { useSession } from "@/lib/auth/auth.client";
import { SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { getInitials } from "@/lib/utils/text";
import { SocialPerformanceDiscovery } from "./social-performance-discovery";
import { SocialPostPerformanceCard } from "./social-post-performance-card";

export function SocialPerformanceResearch({
  projectId,
  data,
  filterContext,
  workspaceId,
  connectionProjects = {},
  projectNames = {},
}: {
  projectId?: string;
  workspaceId?: string;
  connectionProjects?: Record<string, string>;
  projectNames?: Record<string, string>;
  data: SocialPerformanceResponse;
  filterContext?: string;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<string | null>(null);
  const [kind, setKind] = useState<
    "followers" | "mentions" | "likers" | "reposters"
  >("mentions");
  const [selectedPost, setSelectedPost] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [benchmarkHandle, setBenchmarkHandle] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const [exportError, setExportError] = useState(false);
  const xAccounts = data.accounts.filter(
    (account) =>
      account.provider === "x" &&
      account.status === "active" &&
      Boolean(projectId || connectionProjects[account.id]),
  );
  const selectedAccount =
    xAccounts.find((account) => account.id === connection) ?? xAccounts[0];
  const connectionId = selectedAccount?.id;
  const ownerProjectId =
    projectId ?? (connectionId ? connectionProjects[connectionId] : undefined);
  const perPost = kind === "likers" || kind === "reposters";
  const scope = [
    session?.user.id,
    session?.session.activeOrganizationId ?? null,
    ownerProjectId,
    connectionId,
  ];
  // Workspace rankings deduplicate posts. Research requires this connection's own cached IDs.
  const ownedPosts = useInfiniteQuery({
    queryKey: ["social-performance-audience-posts", ...scope, data.range],
    initialPageParam: 0,
    queryFn: async ({
      pageParam,
      signal,
    }): Promise<SocialPerformanceResponse> => {
      const query = new URLSearchParams({
        provider: "x",
        connectionId: connectionId ?? "",
        publishedFrom: new Date(data.range.publishedFrom).toISOString(),
        publishedUntil: new Date(data.range.publishedUntil).toISOString(),
        timezone: data.range.timezone,
        postKind: "all",
        sort: "publishedAt",
        limit: "100",
        offset: String(pageParam),
      });
      const response = await fetch(
        `/api/projects/${encodeURIComponent(ownerProjectId ?? "")}/social-performance?${query}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("performance.researchFailed"));
      const page: SocialPerformanceResponse = await response.json();
      if (!Array.isArray(page?.posts) || !page.pagination)
        throw new Error(t("performance.researchFailed"));
      return page;
    },
    getNextPageParam: (page, _pages, _lastParam, pageParams) => {
      const next = page.pagination.nextOffset;
      return next == null || pageParams.includes(next) ? undefined : next;
    },
    enabled: Boolean(
      open && perPost && ownerProjectId && connectionId && session?.user.id,
    ),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const audiencePosts = (ownedPosts.data?.pages ?? []).flatMap((page) =>
    page.posts.filter(
      (post) =>
        post.provider === "x" &&
        post.connectionId === connectionId &&
        post.postKind !== "repost",
    ),
  );
  const audiencePostId =
    audiencePosts.find((post) => post.id === selectedPost)?.id ??
    audiencePosts[0]?.id;
  const audience = useInfiniteQuery({
    queryKey: [
      "social-performance-audience",
      ...scope,
      kind,
      perPost ? audiencePostId : null,
    ],
    initialPageParam: null as string | null,
    queryFn: async ({
      pageParam,
      signal,
    }): Promise<SocialPerformanceAudienceResponse> => {
      const query = new URLSearchParams({ kind });
      if (perPost && audiencePostId) query.set("postId", audiencePostId);
      if (pageParam) query.set("cursor", pageParam);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(ownerProjectId ?? "")}/social-performance/${encodeURIComponent(connectionId ?? "")}/audience?${query}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("performance.researchFailed"));
      return response.json();
    },
    getNextPageParam: (page, pages, _lastParam, pageParams) =>
      pages.length >= 20 ||
      !page.nextCursor ||
      pageParams.includes(page.nextCursor)
        ? undefined
        : page.nextCursor,
    enabled:
      open &&
      Boolean(
        ownerProjectId &&
          connectionId &&
          session?.user.id &&
          (!perPost || audiencePostId),
      ),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const benchmark = useQuery({
    queryKey: ["social-performance-benchmark", ...scope, benchmarkHandle],
    queryFn: async ({
      signal,
    }): Promise<SocialPerformanceBenchmarkResponse> => {
      const query = new URLSearchParams({ username: benchmarkHandle ?? "" });
      const response = await fetch(
        `/api/projects/${encodeURIComponent(ownerProjectId ?? "")}/social-performance/${encodeURIComponent(connectionId ?? "")}/benchmark?${query}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("performance.researchFailed"));
      return response.json();
    },
    enabled: Boolean(
      open &&
        ownerProjectId &&
        connectionId &&
        benchmarkHandle &&
        session?.user.id,
    ),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const contactsById = new Map<
    string,
    SocialPerformanceAudienceResponse["contacts"][number]
  >();
  for (const page of audience.data?.pages ?? [])
    for (const contact of page.contacts) {
      contactsById.set(contact.id, contact);
    }
  const evidenceById = new Map(
    (audience.data?.pages ?? []).flatMap((page) =>
      (page.posts ?? []).map(
        (evidence) => [evidence.post.externalId, evidence] as const,
      ),
    ),
  );
  const contacts = [...contactsById.values()]
    .map((contact) => {
      if (kind === "mentions") {
        const evidence = [...evidenceById.values()].filter(
          (item) => item.author?.id === contact.id,
        );
        const replies = evidence.filter(
          (item) => item.interactionType === "reply",
        ).length;
        const quotes = evidence.filter(
          (item) => item.interactionType === "quote",
        ).length;
        const mentions = evidence.filter(
          (item) => item.interactionType === "mention",
        ).length;
        return {
          ...contact,
          replies,
          quotes,
          mentions,
          interactions: replies + quotes + mentions,
        };
      }
      if (perPost)
        return {
          ...contact,
          interactions: 1,
          likes: kind === "likers" ? 1 : null,
          reposts: kind === "reposters" ? 1 : null,
        };
      return contact;
    })
    .sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0));
  function number(value: number | null | undefined) {
    return value == null
      ? "—"
      : format.number(value, { maximumFractionDigits: 2 });
  }
  const clipboard = useClipboard({
    copySuccessMessage: t("performance.promptCopied"),
    copyErrorMessage: t("performance.copyFailed"),
  });
  const question =
    t(
      projectId
        ? "performance.analysisPrompt"
        : "performance.workspaceAnalysisPrompt",
      {
        projectId: projectId ?? "",
        workspaceId: workspaceId ?? "",
        from: new Date(data.range.publishedFrom).toISOString(),
        until: new Date(data.range.publishedUntil).toISOString(),
        timezone: data.range.timezone,
      },
    ) +
    (filterContext
      ? `\n${t("performance.analysisFilterContext", { filters: filterContext })}`
      : "");
  async function exportAudience(exportFormat: "csv" | "xlsx") {
    if (!ownerProjectId || !connectionId || !audience.data?.pages.length)
      return;
    setExporting(exportFormat);
    setExportError(false);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(ownerProjectId)}/social-performance/${encodeURIComponent(connectionId)}/audience/export`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            format: exportFormat,
            pages: audience.data.pages,
          }),
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `audience-${kind}.${exportFormat}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(null);
    }
  }
  return (
    <section className="space-y-4">
      <div className="bg-card flex flex-wrap items-start justify-between gap-4 rounded-xl border p-4">
        <div className="max-w-prose space-y-1">
          <h3 className="text-sm font-semibold">{t("performance.analysis")}</h3>
          <p className="text-muted-foreground text-xs">
            {t("performance.analysisHint")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void clipboard.copy(question)}
          >
            {clipboard.copied ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {t(
              clipboard.copied
                ? "performance.promptCopied"
                : "performance.copyPrompt",
            )}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={SOKO_BOTS_ROUTE}>
              <MessageSquare className="size-4" aria-hidden />
              {t("performance.openBots")}
            </Link>
          </Button>
        </div>
        <details className="w-full text-xs">
          <summary className="text-muted-foreground cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t("performance.showQuestion")}
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words">{question}</p>
        </details>
      </div>
      <details
        className="group rounded-xl border p-4"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-4 group-open:rotate-180" aria-hidden />
          {t("performance.audienceBenchmarks")}
        </summary>
        <div className="mt-4 space-y-6">
          <p className="text-muted-foreground text-xs">
            {t("performance.xResearchHint")}
          </p>
          {selectedAccount ? (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="performance-research-account">
                    {t("account")}
                  </Label>
                  <Select value={connectionId} onValueChange={setConnection}>
                    <SelectTrigger id="performance-research-account">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {xAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.displayName ?? account.externalHandle ?? "X"}
                          {workspaceId
                            ? ` · ${projectNames[connectionProjects[account.id]] ?? ""}`
                            : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="performance-audience-kind">
                    {t("performance.audience")}
                  </Label>
                  <Select
                    value={kind}
                    onValueChange={(value) => {
                      if (
                        value === "followers" ||
                        value === "mentions" ||
                        value === "likers" ||
                        value === "reposters"
                      )
                        setKind(value);
                    }}
                  >
                    <SelectTrigger id="performance-audience-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mentions">
                        {t("performance.engagedContacts")}
                      </SelectItem>
                      <SelectItem value="followers">
                        {t("accountMetrics.followers")}
                      </SelectItem>
                      <SelectItem value="likers">
                        {t("performance.postLikers")}
                      </SelectItem>
                      <SelectItem value="reposters">
                        {t("performance.postReposters")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {perPost ? (
                <div className="max-w-xl space-y-2">
                  <Label htmlFor="performance-audience-post">
                    {t("performance.post")}
                  </Label>
                  <Select
                    value={audiencePostId}
                    onValueChange={setSelectedPost}
                  >
                    <SelectTrigger
                      id="performance-audience-post"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {audiencePosts.map((post) => (
                        <SelectItem key={post.id} value={post.id}>
                          {post.text ? post.text.slice(0, 100) : t("mediaPost")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {t("performance.audiencePostsHint")}
                  </p>
                  {ownedPosts.isFetching ? (
                    <p role="status" className="text-muted-foreground text-xs">
                      {t("loading")}
                    </p>
                  ) : null}
                  {ownedPosts.isError ? (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center gap-3"
                    >
                      <p className="text-semantic-warning text-xs">
                        {t("performance.researchFailed")}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void ownedPosts.refetch()}
                        loading={ownedPosts.isFetching}
                      >
                        {t("retry")}
                      </Button>
                    </div>
                  ) : null}
                  {ownedPosts.hasNextPage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void ownedPosts.fetchNextPage()}
                      loading={ownedPosts.isFetchingNextPage}
                      disabled={ownedPosts.isFetching}
                    >
                      {t("loadMore")}
                    </Button>
                  ) : null}
                  {!ownedPosts.isPending &&
                  !ownedPosts.isError &&
                  !audiencePosts.length ? (
                    <p className="text-muted-foreground text-xs">
                      {t("performance.syncPostsForAudience")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div role="status" className="text-muted-foreground text-xs">
                {audience.isFetching ? t("loading") : ""}
              </div>
              {audience.isError ? (
                <div role="alert" className="flex flex-wrap items-center gap-3">
                  <p className="text-semantic-warning text-sm">
                    {t("performance.researchFailed")}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void audience.refetch()}
                    loading={audience.isFetching}
                  >
                    {t("retry")}
                  </Button>
                </div>
              ) : null}
              {audience.data ? (
                <section className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(["csv", "xlsx"] as const).map((exportFormat) => (
                      <Button
                        key={exportFormat}
                        size="sm"
                        variant="outline"
                        loading={exporting === exportFormat}
                        disabled={Boolean(exporting) || audience.isFetching}
                        onClick={() => void exportAudience(exportFormat)}
                      >
                        <Download className="size-4" aria-hidden />
                        {t("performance.exportAudience", {
                          format: exportFormat.toUpperCase(),
                        })}
                      </Button>
                    ))}
                  </div>
                  {exportError ? (
                    <p role="alert" className="text-semantic-warning text-xs">
                      {t("performance.exportFailed")}
                    </p>
                  ) : null}
                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("performance.contact")}</TableHead>
                          <TableHead>{t("performance.location")}</TableHead>
                          <TableHead className="text-end">
                            {t("accountMetrics.followers")}
                          </TableHead>
                          {kind !== "followers" ? (
                            <>
                              <TableHead className="text-end">
                                {t("performance.interactions")}
                              </TableHead>
                              <TableHead className="text-end">
                                {t(
                                  perPost
                                    ? "metrics.likes"
                                    : "performance.kinds.replies",
                                )}
                              </TableHead>
                              <TableHead className="text-end">
                                {t(
                                  perPost
                                    ? "performance.kinds.reposts"
                                    : "accountMetrics.quotes",
                                )}
                              </TableHead>
                            </>
                          ) : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contacts.map((contact) => (
                          <TableRow key={contact.id}>
                            <TableCell>
                              <a
                                className="flex min-h-10 w-fit items-center gap-2 rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                href={`https://x.com/${encodeURIComponent(contact.username)}`}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                <Avatar className="size-8">
                                  <AvatarImage
                                    src={contact.avatarUrl ?? undefined}
                                    alt=""
                                  />
                                  <AvatarFallback>
                                    {getInitials(contact.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="max-w-56 whitespace-normal">
                                  <span className="block text-sm">
                                    {contact.name}
                                  </span>
                                  <span className="text-muted-foreground text-xs">
                                    @{contact.username}
                                  </span>
                                </span>
                              </a>
                            </TableCell>
                            <TableCell className="text-muted-foreground max-w-48 whitespace-normal text-xs">
                              {contact.location ?? "—"}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">
                              {number(contact.followersCount)}
                            </TableCell>
                            {kind !== "followers" ? (
                              <>
                                <TableCell className="text-end tabular-nums">
                                  {number(contact.interactions)}
                                </TableCell>
                                <TableCell className="text-end tabular-nums">
                                  {number(
                                    perPost ? contact.likes : contact.replies,
                                  )}
                                </TableCell>
                                <TableCell className="text-end tabular-nums">
                                  {number(
                                    perPost ? contact.reposts : contact.quotes,
                                  )}
                                </TableCell>
                              </>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {!contacts.length ? (
                    <p className="text-muted-foreground text-sm">
                      {t("performance.noContacts")}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {audience.data.pages.at(-1)?.coverage}
                  </p>
                  {audience.data.pages.length >= 20 ? (
                    <p className="text-muted-foreground text-xs">
                      {t("performance.audienceLimit")}
                    </p>
                  ) : null}
                  {audience.hasNextPage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={audience.isFetchingNextPage}
                      onClick={() => void audience.fetchNextPage()}
                    >
                      {t("performance.loadMoreContacts")}
                    </Button>
                  ) : null}
                  {kind === "mentions" && evidenceById.size ? (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">
                        {t("performance.incomingPosts")}
                      </h4>
                      <p className="text-muted-foreground text-xs">
                        {t("performance.incomingPostsHint")}
                      </p>
                      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                        {[...evidenceById.values()].map(
                          ({ author, post: incomingPost }) => (
                            <SocialPostPerformanceCard
                              key={incomingPost.externalId}
                              post={incomingPost}
                              account={
                                author
                                  ? {
                                      displayName: author.name,
                                      externalHandle: author.username,
                                      avatarUrl: author.avatarUrl,
                                    }
                                  : {
                                      displayName: t(
                                        "performance.unknownAuthor",
                                      ),
                                      externalHandle: null,
                                      avatarUrl: null,
                                    }
                              }
                            />
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
              <section className="space-y-4 border-t pt-6">
                <h4 className="text-sm font-medium">
                  {t("performance.benchmark")}
                </h4>
                <p className="text-muted-foreground text-xs">
                  {t("performance.benchmarkHint")}
                </p>
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setBenchmarkHandle(username.replace(/^@/, ""));
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="performance-benchmark-handle">
                      {t("performance.xHandle")}
                    </Label>
                    <Input
                      id="performance-benchmark-handle"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="@handle"
                      pattern="@?[A-Za-z0-9_]{1,15}"
                      required
                      maxLength={16}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    loading={benchmark.isFetching}
                  >
                    {t("performance.compareProfile")}
                  </Button>
                </form>
                {benchmark.isError ? (
                  <p role="alert" className="text-semantic-warning text-sm">
                    {t("performance.researchFailed")}
                  </p>
                ) : null}
                {benchmark.data ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Avatar className="size-10">
                        <AvatarImage
                          src={benchmark.data.profile.avatarUrl ?? undefined}
                          alt=""
                        />
                        <AvatarFallback>
                          {getInitials(benchmark.data.profile.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h5 className="text-sm font-medium">
                          {benchmark.data.profile.name}
                        </h5>
                        <p className="text-muted-foreground text-xs">
                          @{benchmark.data.profile.username} ·{" "}
                          {number(benchmark.data.profile.followersCount)}{" "}
                          {t("accountMetrics.followers")}
                        </p>
                      </div>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t("updatedAt", {
                        date: format.dateTime(
                          new Date(benchmark.data.observedAt),
                          "dateTime",
                          {
                            timeZone: data.range.timezone,
                            timeZoneName: "short",
                          },
                        ),
                      })}
                    </p>
                    <dl className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <dt className="text-muted-foreground text-xs">
                          {t("performance.posts")}
                        </dt>
                        <dd className="mt-1 text-xl font-medium tabular-nums">
                          {format.number(benchmark.data.summary.postCount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">
                          {t("performance.meanMedianLabel")}
                        </dt>
                        <dd className="mt-1 text-xl font-medium tabular-nums">
                          {number(benchmark.data.summary.interactions.mean)} /{" "}
                          {number(benchmark.data.summary.interactions.median)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">
                          {t("performance.exposureFollowers")}
                        </dt>
                        <dd className="mt-1 text-xl font-medium tabular-nums">
                          {number(benchmark.data.meanImpressionsToFollowers)}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-muted-foreground text-xs">
                      {benchmark.data.coverage}
                    </p>
                    <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
                      {benchmark.data.posts.slice(0, 3).map((post) => (
                        <SocialPostPerformanceCard
                          key={post.id}
                          post={post}
                          account={{
                            displayName: benchmark.data?.profile.name ?? null,
                            externalHandle:
                              benchmark.data?.profile.username ?? null,
                            avatarUrl:
                              benchmark.data?.profile.avatarUrl ?? null,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
              {ownerProjectId ? (
                <SocialPerformanceDiscovery
                  projectId={ownerProjectId}
                  account={selectedAccount}
                  timezone={data.range.timezone}
                />
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("performance.connectX")}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
