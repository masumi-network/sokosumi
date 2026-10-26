import type {
  SocialAccountPost,
  SocialAccountStatisticsAccount,
} from "@sokosumi/core-client";
import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { TimezoneLabel } from "@/components/timezone-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SocialMetricTiles } from "./social-account-metrics";
import { SocialPostMetrics } from "./social-post-metrics";
import { SocialPostPreview } from "./social-post-preview";

interface SocialPublishedPostProps {
  post: SocialAccountPost;
  account: Pick<
    SocialAccountStatisticsAccount,
    "externalHandle" | "displayName" | "avatarUrl"
  > | null;
  actions?: React.ReactNode;
}

export function SocialPublishedPost({
  post,
  account,
  actions,
}: SocialPublishedPostProps) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  const timestamp = post.publishedAt ? new Date(post.publishedAt) : null;
  const media = post.media ?? [];
  const hasKeyMetrics = Object.values(post.metrics).some(
    (value) => value != null,
  );
  const hasMetrics =
    hasKeyMetrics ||
    post.additionalMetrics.some((metric) => metric.value != null);

  return (
    <li className="grid min-w-0 gap-6 rounded-xl border p-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <SocialPostPreview
        account={
          account
            ? {
                handle: account.externalHandle,
                displayName: account.displayName,
                avatarUrl: account.avatarUrl,
              }
            : null
        }
        className="w-full min-w-0 max-w-md self-start lg:max-w-none"
        compact
        media={media}
        mediaUnavailable={media.length === 0}
        provider={post.provider}
        text={post.text}
        timestamp={timestamp}
        timestampLabel={timestamp ? undefined : t("dateUnavailable")}
      />
      <div className="min-w-0 space-y-4">
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          {timestamp ? (
            <time dateTime={timestamp.toISOString()}>
              {formatter.dateTime(timestamp, "dateTime", {
                timeZone: "UTC",
              })}{" "}
              <TimezoneLabel timeZone="UTC" at={timestamp} variant="short" />
            </time>
          ) : (
            t("dateUnavailable")
          )}
          {post.strong ? (
            <Badge variant="secondary">{t("recycle.strong")}</Badge>
          ) : null}
        </div>
        {hasMetrics ? (
          <SocialPostMetrics
            hideUpdatedAt
            extra={
              <SocialMetricTiles
                metrics={post.additionalMetrics}
                showLifetime={false}
              />
            }
            statistics={{
              metrics: post.metrics,
              fetchedAt: post.fetchedAt,
              refreshAttemptedAt: null,
              error: null,
            }}
          />
        ) : null}
        {!hasMetrics ? (
          <p className="text-muted-foreground text-sm">{t("noPostMetrics")}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {t("updatedAt", {
            date: formatter.relativeTime(new Date(post.fetchedAt)),
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {post.url ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="min-h-11 max-w-full whitespace-normal md:min-h-8"
            >
              <a href={post.url} target="_blank" rel="noreferrer noopener">
                {t("openPost")}
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : null}
          {actions}
        </div>
      </div>
    </li>
  );
}
