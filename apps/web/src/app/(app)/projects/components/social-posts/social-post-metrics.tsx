"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

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
  variant = "default",
}: {
  statistics: SocialPost["statistics"];
  variant?: "default" | "compact" | "summary";
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  const compact = variant === "compact";
  const summary = variant === "summary";
  return (
    <div className={cn("space-y-2", summary && "@container")}>
      <dl
        className={
          summary
            ? "grid grid-cols-2 gap-x-4 gap-y-5 @sm:grid-cols-3"
            : compact
              ? "flex flex-wrap gap-x-3 gap-y-1 text-xs"
              : "grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6"
        }
      >
        {SOCIAL_METRIC_KEYS.map((key) => {
          const value = statistics?.metrics[key];
          return (
            <div
              key={key}
              className={cn(
                compact ? "flex gap-1" : "space-y-1",
                summary && "flex min-w-0 flex-col gap-1 space-y-0",
              )}
            >
              <dt
                className={cn(
                  "text-muted-foreground",
                  summary && "order-2 text-xs",
                )}
              >
                {t(`metrics.${key}`)}
              </dt>
              <dd
                className={cn(
                  "font-medium tabular-nums",
                  summary && "order-1 text-xl tracking-tight",
                )}
                title={
                  summary && value != null ? formatter.number(value) : undefined
                }
              >
                {value == null && summary ? (
                  <span
                    title={t("unavailable")}
                    className="text-muted-foreground"
                  >
                    <span aria-hidden>—</span>
                    <span className="sr-only">{t("unavailable")}</span>
                  </span>
                ) : value == null ? (
                  t("unavailable")
                ) : (
                  formatter.number(
                    value,
                    summary && Math.abs(value) >= 10000
                      ? { notation: "compact", maximumFractionDigits: 1 }
                      : undefined,
                  )
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-muted-foreground text-xs">
        {statistics?.fetchedAt
          ? t("updatedAt", {
              date: formatter.dateTime(
                new Date(statistics.fetchedAt),
                "dateTime",
                summary
                  ? { timeZone: "UTC", timeZoneName: "short" }
                  : undefined,
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
