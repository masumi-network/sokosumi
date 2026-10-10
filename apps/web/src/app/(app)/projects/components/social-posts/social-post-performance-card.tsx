"use client";

import type {
  SocialAccountPost,
  SocialAccountStatisticsAccount,
} from "@sokosumi/core-client";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { SocialPostMetrics } from "./social-post-metrics";
import { SocialPostPreview } from "./social-post-preview";

interface SocialPostPerformanceCardProps {
  post: SocialAccountPost;
  account?: SocialAccountStatisticsAccount;
  children?: ReactNode;
}

export function SocialPostPerformanceCard({
  post,
  account,
  children,
}: SocialPostPerformanceCardProps) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  return (
    <article className="bg-card text-card-foreground flex h-full min-w-0 flex-col overflow-hidden rounded-xl border">
      <SocialPostPreview
        account={{
          displayName: account?.displayName ?? account?.externalHandle ?? null,
          handle: account?.externalHandle ?? null,
          avatarUrl: account?.avatarUrl ?? null,
        }}
        className="bg-card rounded-none border-0"
        media={post.media ?? []}
        provider={post.provider}
        text={post.text || t("mediaPost")}
        timestamp={post.publishedAt ? new Date(post.publishedAt) : null}
        timestampLabel={
          post.publishedAt
            ? formatter.dateTime(new Date(post.publishedAt), "dateTime", {
                timeZone: "UTC",
                timeZoneName: "short",
              })
            : t("dateUnavailable")
        }
        showMediaPlaceholder={false}
        showEngagementActions={false}
      />
      <div className="mt-auto space-y-4 border-t p-4">
        <SocialPostMetrics
          variant="summary"
          statistics={{
            metrics: post.metrics,
            fetchedAt: post.fetchedAt,
            refreshAttemptedAt: null,
            error: null,
          }}
        />
        <div className="flex flex-wrap items-start justify-between gap-3 text-xs">
          {children ? (
            <details className="group min-w-0">
              <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-1 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  className="size-3.5 shrink-0 group-open:rotate-180"
                  aria-hidden
                />
                {t("moreMetrics")}
              </summary>
              <div className="pt-3">{children}</div>
            </details>
          ) : null}
          {post.url ? (
            <a
              className="text-muted-foreground hover:text-foreground ms-auto flex items-center gap-1 rounded-sm py-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href={post.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("openPost")}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
