import type { SocialAccountMetric } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";

const ACCOUNT_METRIC_LABELS: Record<string, string> = {
  followers_count: "followers",
  follows_count: "following",
  following_count: "following",
  tweet_count: "posts",
  listed_count: "lists",
  posts_liked_count: "postsLiked",
  viewCount: "views",
  videoCount: "videos",
  subscriberCount: "subscribers",
  accounts_engaged: "engagedAccounts",
  total_interactions: "interactions",
  profile_links_taps: "profileLinkClicks",
  page_media_view: "views",
  page_post_engagements: "engagement",
  page_video_views: "video_views",
  page_daily_follows_unique: "newFollowers",
  page_daily_unfollows_unique: "lostFollowers",
  page_total_actions: "actions",
  page_total_media_view_unique: "reach",
  estimatedMinutesWatched: "watch_time",
  averageViewDuration: "averageWatchDuration",
  averageViewPercentage: "averageViewedPercent",
  subscribersGained: "newSubscribers",
  subscribersLost: "lostSubscribers",
  post_media_view: "views",
  post_total_media_view_unique: "reach",
  post_activity_by_action_type: "actions",
  url_clicks: "linkClicks",
  saved: "saves",
  like_count: "likes",
  comment_count: "comments",
  share_count: "shares",
  save_count: "saves",
  likes_count: "likes_received",
  quote_count: "quotes",
  dislikeCount: "dislikes",
  ig_reels_video_view_total_time: "totalWatchTime",
  ig_reels_avg_watch_time: "averageWatchTime",
  reels_skip_rate: "skipRate",
  facebook_views: "facebookViews",
  crossposted_views: "crosspostedViews",
};

interface SocialAccountMetricsProps {
  metrics: SocialAccountMetric[];
  showLifetime?: boolean;
}

export function SocialMetricTiles({
  metrics,
  showLifetime = true,
}: SocialAccountMetricsProps) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();

  function metricLabel(metric: SocialAccountMetric) {
    const key = `accountMetrics.${ACCOUNT_METRIC_LABELS[metric.key] ?? metric.key}`;
    return t.has(key)
      ? t(key)
      : metric.key
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replaceAll(/[_.-]/g, " ")
          .replace(/^./, (letter) => letter.toUpperCase());
  }

  return (
    <>
      {metrics.map((metric, index) => {
        const unit = metric.unit === "milliseconds" ? "seconds" : metric.unit;
        return (
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
                : formatter.number(
                    metric.unit === "milliseconds"
                      ? metric.value / 1000
                      : metric.value,
                  )}
              {unit && unit !== "count" && metric.value != null ? (
                <span className="text-muted-foreground ms-1 font-normal">
                  {t.has(`units.${unit}`) ? t(`units.${unit}`) : unit}
                </span>
              ) : null}
            </dd>
            {metric.period && (showLifetime || metric.period !== "lifetime") ? (
              <dd className="text-muted-foreground text-xs">
                {t.has(`periods.${metric.period}`)
                  ? t(`periods.${metric.period}`)
                  : metric.period.replaceAll(/[_-]/g, " ")}
              </dd>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function SocialAccountMetrics(props: SocialAccountMetricsProps) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <SocialMetricTiles {...props} />
    </dl>
  );
}
