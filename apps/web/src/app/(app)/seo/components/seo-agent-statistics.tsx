"use client";

import { ChartColumn, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { seoAuditName } from "./seo-audit-name";
import { SeoConnectionButton } from "./seo-connection-button";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoStatisticsProperties } from "./use-seo-statistics-properties";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Why no Google Analytics data is saved: each state names its cause and, where one exists, its fix. */
type SeoAnalyticsState =
  | "unknown"
  | "missing"
  | "loading"
  | "failed"
  | "no_property"
  | "choose"
  | "empty";

/**
 * The Google statistics of the Agent tab as one slim line at its top. It shows only while no Analytics data is
 * saved, and says why: the sync runs by itself, so "not synced yet" was never the reason.
 */
export function SeoAgentStatistics({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const status = useSeoConnectionStatus("ga4").status.data?.status;
  const connected = status === "connected";
  const { properties } = useSeoStatisticsProperties(
    model.data,
    "ga4",
    connected,
  );
  const sync = model.statisticsSync.analytics;
  const listed =
    properties.data?.status === "available"
      ? properties.data.properties.length
      : null;
  // A connection that is starting has no state yet. An expired connection reads as none.
  const analytics: SeoAnalyticsState =
    status === undefined || status === "pending"
      ? "unknown"
      : !connected
        ? "missing"
        : sync.failed
          ? "failed"
          : sync.loading
            ? "loading"
            : listed === 0
              ? "no_property"
              : sync.needsProperty
                ? "choose"
                : "empty";
  const [connectError, setConnectError] = useState<string | null>(null);
  const page = model.data.pages.find((item) =>
    model.data.scope.pageIds.includes(item.id),
  );
  // A failed or running sync has its own line with Retry in the verdict card: this line only names it.
  const control =
    analytics === "missing" ? (
      <SeoConnectionButton provider="ga4" onError={setConnectError} compact />
    ) : analytics === "choose" || analytics === "no_property" ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => model.openStatistics("ga4")}
      >
        <Settings2 />
        {analytics === "choose"
          ? t("agent.chooseProperty")
          : t("manageStatistics")}
      </Button>
    ) : null;
  return (
    <div
      className={cn(
        "bg-background flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm",
        // The causes the reader can fix stand out; a sync that runs or found nothing stays quiet.
        (analytics === "choose" || analytics === "failed") && "border-chart-2",
      )}
      data-testid="seo-agent-statistics"
    >
      <ChartColumn
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      <p
        role={connectError ? "alert" : undefined}
        className={cn(
          "min-w-0 flex-1 basis-48 break-words",
          connectError && "text-destructive",
          analytics === "loading" && "text-muted-foreground",
        )}
      >
        {connectError ??
          t("agent.statistics", {
            analytics,
            count: listed ?? 0,
            site: page ? seoAuditName("", page.url) : "",
          })}
      </p>
      {control}
    </div>
  );
}
