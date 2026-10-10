"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";

export const SOCIAL_METRIC_KEYS = [
  "views",
  "impressions",
  "likes",
  "comments",
  "shares",
  "saves",
] as const;

export function SocialPostMetrics({
  statistics,
  compact = false,
}: {
  statistics: SocialPost["statistics"];
  compact?: boolean;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  return (
    <div className="space-y-2">
      <dl
        className={
          compact
            ? "flex flex-wrap gap-x-3 gap-y-1 text-xs"
            : "grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6"
        }
      >
        {SOCIAL_METRIC_KEYS.flatMap((key) => {
          const value = statistics?.metrics[key];
          if (!compact && value == null) return [];
          return [
            <div key={key} className={compact ? "flex gap-1" : "space-y-1"}>
              <dt className="text-muted-foreground">{t(`metrics.${key}`)}</dt>
              <dd className="font-medium tabular-nums">
                {value == null ? t("unavailable") : formatter.number(value)}
              </dd>
            </div>,
          ];
        })}
      </dl>
      <p className="text-muted-foreground text-xs">
        {statistics?.fetchedAt
          ? t("updatedAt", {
              date: formatter.dateTime(
                new Date(statistics.fetchedAt),
                "dateTime",
              ),
            })
          : t("notFetched")}
      </p>
      {statistics?.error ? (
        <p role="status" className="text-semantic-warning text-xs">
          {t("refreshFailed")}
        </p>
      ) : null}
    </div>
  );
}
