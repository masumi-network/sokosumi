import type {
  SocialAccountPost,
  SocialAccountStatisticsAccount,
} from "@sokosumi/core-client";
import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SocialAccountMetrics } from "./social-account-metrics";
import { SocialPostMetrics } from "./social-post-metrics";
import { SocialPostPreview } from "./social-post-preview";

interface SocialPublishedPostProps {
  post: SocialAccountPost;
  account: Pick<
    SocialAccountStatisticsAccount,
    "externalHandle" | "displayName" | "avatarUrl"
  > | null;
}

export function SocialPublishedPost({
  post,
  account,
}: SocialPublishedPostProps) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  const timestamp = post.publishedAt ? new Date(post.publishedAt) : null;
  const hasKeyMetrics = Object.values(post.metrics).some(
    (value) => value != null,
  );
  const hasMetrics =
    hasKeyMetrics ||
    post.additionalMetrics.some((metric) => metric.value != null);

  return (
    <li className="grid min-w-0 gap-6 rounded-xl border p-4 lg:grid-cols-2">
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
        className="w-full min-w-0 max-w-md self-start"
        compact
        media={[]}
        mediaUnavailable
        provider={post.provider}
        text={post.text}
        timestamp={timestamp}
        timestampLabel={timestamp ? undefined : t("dateUnavailable")}
      />
      <div className="min-w-0 space-y-4">
        <p className="text-muted-foreground text-xs">
          {timestamp ? (
            <time dateTime={timestamp.toISOString()}>
              {formatter.dateTime(timestamp, "dateTime", {
                timeZone: "UTC",
                timeZoneName: "short",
              })}
            </time>
          ) : (
            t("dateUnavailable")
          )}
        </p>
        {hasKeyMetrics ? (
          <SocialPostMetrics
            hideUpdatedAt
            statistics={{
              metrics: post.metrics,
              fetchedAt: post.fetchedAt,
              refreshAttemptedAt: null,
              error: null,
            }}
          />
        ) : null}
        {hasMetrics && post.additionalMetrics.length ? (
          <SocialAccountMetrics
            metrics={post.additionalMetrics}
            showLifetime={false}
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
      </div>
    </li>
  );
}
