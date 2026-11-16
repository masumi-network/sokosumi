"use client";

import { ChartColumn, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  seoAnalyticsAction,
  seoAnalyticsHidden,
  seoAnalyticsState,
} from "./seo-agent-statistics-model";
import { seoAuditName } from "./seo-audit-name";
import { SeoConnectionButton } from "./seo-connection-button";
import { useSeoConnectionStatus } from "./use-seo-connection";
import { useSeoFocusHandoff } from "./use-seo-focus-handoff";
import { useSeoStatisticsProperties } from "./use-seo-statistics-properties";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The Google statistics of the Agent tab as one slim line at its top. It shows only while no Analytics data is
 * saved, and says why: the sync runs by itself, so "not synced yet" was never the reason.
 */
export function SeoAgentStatistics({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const status = useSeoConnectionStatus("ga4").status.data?.status;
  const connected = status === "connected";
  const { properties, propertyId } = useSeoStatisticsProperties(
    model.data,
    "ga4",
    connected,
  );
  const sync = model.statisticsSync.analytics;
  const listed =
    properties.data?.status === "available" ? properties.data.properties : null;
  const analytics = seoAnalyticsState({
    status,
    sync,
    properties: listed?.length ?? null,
    picked: Boolean(propertyId),
  });
  // The one property of an account is read even when its name is not the site's: the line names it.
  const property = listed?.find((item) => item.id === propertyId)?.name ?? "";
  const [connectError, setConnectError] = useState<string | null>(null);
  const page = model.data.pages.find((item) =>
    model.data.scope.pageIds.includes(item.id),
  );
  const action = seoAnalyticsAction(analytics, connected, listed?.length ?? 0);
  const hidden = seoAnalyticsHidden(analytics, connected);
  const { box, target } = useSeoFocusHandoff(action, hidden);
  // A status that is not read yet gets the connect button, which shows its wait and its own Try again.
  const control = hidden ? null : action === "connect" ? (
    <SeoConnectionButton provider="ga4" onError={setConnectError} compact />
  ) : action ? (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => model.openStatistics("ga4")}
    >
      <Settings2 />
      {action === "manage" ? t("manageStatistics") : t("agent.chooseProperty")}
    </Button>
  ) : null;
  return (
    // Hidden, the line keeps its status node, out of sight and empty: a screen reader hears the next cause in a
    // live region it already knows, which a new node would not give.
    <div
      ref={box}
      className={cn(
        hidden
          ? "sr-only"
          : "bg-background flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm",
        // A cause that stops the data stands out: a property to choose.
        analytics === "choose" && "border-chart-2",
      )}
      data-testid={hidden ? undefined : "seo-agent-statistics"}
    >
      <ChartColumn
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      {/* A failed connect says so in the place of the line's text, in an alert of its own. */}
      {connectError && !hidden ? (
        <p
          role="alert"
          className="text-destructive min-w-0 flex-1 basis-48 break-words"
        >
          {connectError}
        </p>
      ) : (
        // The cause changes on its own: a screen reader hears the new one.
        <p
          ref={target}
          role="status"
          tabIndex={-1}
          className="min-w-0 flex-1 basis-48 break-words"
        >
          {hidden
            ? null
            : t("agent.statistics", {
                analytics,
                count: listed?.length ?? 0,
                site: page ? seoAuditName("", page.url) : "",
                property,
              })}
        </p>
      )}
      {control}
    </div>
  );
}
