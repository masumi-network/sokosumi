"use client";

import type {
  SocialAccountStatisticsAccount,
  SocialPerformanceDiscoveryResponse,
} from "@sokosumi/core-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
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
import { useSession } from "@/lib/auth/auth.client";
import { SocialPostPerformanceCard } from "./social-post-performance-card";

/** Public search is explicitly requested and remains separate from account analytics. */
export function SocialPerformanceDiscovery({
  projectId,
  account,
  timezone,
}: {
  projectId: string;
  account: SocialAccountStatisticsAccount;
  timezone: string;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const { data: session } = useSession();
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const discovery = useInfiniteQuery({
    queryKey: [
      "social-performance-discovery",
      session?.user.id,
      session?.session.activeOrganizationId ?? null,
      projectId,
      account.id,
      submitted,
    ],
    initialPageParam: null as {
      cursor: string;
      publishedFrom: string;
      publishedUntil: string;
    } | null,
    queryFn: async ({
      pageParam,
      signal,
    }): Promise<SocialPerformanceDiscoveryResponse> => {
      const query = new URLSearchParams(submitted ?? "");
      if (pageParam) {
        query.set("cursor", pageParam.cursor);
        if (!query.has("publishedFrom"))
          query.set("publishedFrom", pageParam.publishedFrom);
        if (!query.has("publishedUntil"))
          query.set("publishedUntil", pageParam.publishedUntil);
      }
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/social-performance/${encodeURIComponent(account.id)}/discovery?${query}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t("performance.researchFailed"));
      return response.json();
    },
    getNextPageParam: (page, pages, _lastParam, pageParams) => {
      const first = pages[0];
      if (
        !first ||
        pages.length >= 20 ||
        !page.nextCursor ||
        pageParams.some((seen) => seen?.cursor === page.nextCursor)
      )
        return undefined;
      return {
        cursor: page.nextCursor,
        publishedFrom: new Date(first.publishedFrom).toISOString(),
        publishedUntil: new Date(first.publishedUntil).toISOString(),
      };
    },
    enabled: Boolean(submitted && session?.user.id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const evidence = [
    ...new Map(
      (discovery.data?.pages ?? []).flatMap((page) =>
        page.posts.map((item) => [item.post.externalId, item] as const),
      ),
    ).values(),
  ];
  const now = new Date();
  const latestDate = now.toISOString().slice(0, 10);
  const earliestDate = new Date(now.getTime() - 6 * 86400000)
    .toISOString()
    .slice(0, 10);
  function dateTime(date: Date) {
    return format.dateTime(new Date(date), "dateTime", {
      timeZone: timezone,
      timeZoneName: "short",
    });
  }
  return (
    <section className="space-y-4 border-t pt-6">
      <h4 className="text-sm font-medium">{t("performance.discovery")}</h4>
      <p className="text-muted-foreground max-w-prose text-xs">
        {t("performance.discoveryHint")}
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const query = new URLSearchParams();
          for (const [key, raw] of fields) {
            if (typeof raw !== "string" || !raw.trim()) continue;
            let value = raw.trim();
            if (key === "username") value = value.replace(/^@/, "");
            if (key === "publishedFrom") value = `${value}T00:00:00.000Z`;
            if (key === "publishedUntil")
              value = new Date(
                Math.min(
                  new Date(`${value}T23:59:59.999Z`).getTime(),
                  Date.now(),
                ),
              ).toISOString();
            query.set(key, value);
          }
          const minimum = query.get("minFollowers"),
            maximum = query.get("maxFollowers");
          const from = query.get("publishedFrom"),
            until = query.get("publishedUntil");
          const isInvalid =
            (!query.has("topic") && !query.has("username")) ||
            (minimum != null &&
              maximum != null &&
              Number(minimum) > Number(maximum)) ||
            Boolean(from && until && new Date(from) >= new Date(until));
          setInvalid(isInvalid);
          if (!isInvalid) setSubmitted(query.toString());
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="discovery-topic">{t("performance.topic")}</Label>
            <Input
              id="discovery-topic"
              name="topic"
              maxLength={200}
              placeholder={t("performance.topicPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="discovery-username">
              {t("performance.xHandle")}
            </Label>
            <Input
              id="discovery-username"
              name="username"
              maxLength={16}
              pattern="@?[A-Za-z0-9_]{1,15}"
              placeholder="@handle"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="discovery-language">
              {t("performance.language")}
            </Label>
            <Input
              id="discovery-language"
              name="language"
              maxLength={3}
              pattern="[a-z]{2,3}"
              placeholder="en"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="discovery-format">
              {t("performance.contentType")}
            </Label>
            <Select name="format" defaultValue="any">
              <SelectTrigger id="discovery-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">
                  {t("performance.allFormats")}
                </SelectItem>
                {(["text", "image", "video", "carousel", "link"] as const).map(
                  (type) => (
                    <SelectItem key={type} value={type}>
                      {t(`performance.formats.${type}`)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <details className="space-y-3 rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t("performance.discoveryFilters")}
          </summary>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="discovery-from">{t("publishedFrom")}</Label>
              <Input
                id="discovery-from"
                name="publishedFrom"
                type="date"
                min={earliestDate}
                max={latestDate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discovery-until">{t("publishedUntil")}</Label>
              <Input
                id="discovery-until"
                name="publishedUntil"
                type="date"
                min={earliestDate}
                max={latestDate}
              />
            </div>
            {(
              [
                "minLikes",
                "minComments",
                "minShares",
                "minImpressions",
                "minFollowers",
                "maxFollowers",
              ] as const
            ).map((key) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`discovery-${key}`}>
                  {t(`performance.discoveryThresholds.${key}`)}
                </Label>
                <Input
                  id={`discovery-${key}`}
                  name={key}
                  type="number"
                  min={0}
                  max={Number.MAX_SAFE_INTEGER}
                  step={1}
                />
              </div>
            ))}
          </div>
        </details>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="discovery-sort">{t("performance.sort")}</Label>
            <Select name="sort" defaultValue="recency">
              <SelectTrigger id="discovery-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["recency", "likes", "impressions"] as const).map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`performance.discoverySorts.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            variant="outline"
            loading={discovery.isFetching}
          >
            {t("performance.searchPublicPosts")}
          </Button>
        </div>
        {invalid ? (
          <p role="alert" className="text-semantic-warning text-xs">
            {t("performance.invalidDiscovery")}
          </p>
        ) : null}
      </form>
      {discovery.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-semantic-warning text-xs">
            {t("performance.researchFailed")}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void discovery.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {discovery.data ? (
        <div className="space-y-4">
          <p className="text-muted-foreground text-xs">
            {t("performance.discoveryRange", {
              from: dateTime(discovery.data.pages[0].publishedFrom),
              until: dateTime(discovery.data.pages[0].publishedUntil),
            })}
          </p>
          <p className="text-muted-foreground text-xs">
            {discovery.data.pages.at(-1)?.coverage}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("performance.discoverySample", {
              shown: evidence.length,
              sampled: discovery.data.pages.reduce(
                (sum, page) => sum + page.samplePostCount,
                0,
              ),
              missing: discovery.data.pages.reduce(
                (sum, page) => sum + page.missingCounterPostCount,
                0,
              ),
            })}
          </p>
          {!evidence.length ? (
            <p className="text-muted-foreground text-sm">
              {t("performance.noDiscoveryPosts")}
            </p>
          ) : null}
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
            {evidence.map(({ author, post }) => (
              <SocialPostPerformanceCard
                key={post.externalId}
                post={post}
                account={
                  author
                    ? {
                        displayName: author.name,
                        externalHandle: author.username,
                        avatarUrl: author.avatarUrl,
                      }
                    : {
                        displayName: t("performance.unknownAuthor"),
                        externalHandle: null,
                        avatarUrl: null,
                      }
                }
              />
            ))}
          </div>
          {discovery.hasNextPage ? (
            <Button
              size="sm"
              variant="outline"
              loading={discovery.isFetchingNextPage}
              onClick={() => void discovery.fetchNextPage()}
            >
              {t("loadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
