"use client";

import { ChartColumn, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  seoAnalyticsAction,
  seoAnalyticsState,
} from "./seo-agent-statistics-model";
import { seoAuditName } from "./seo-audit-name";
import { SeoConnectionButton } from "./seo-connection-button";
import { useSeoConnectionStatus } from "./use-seo-connection";
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
  });
  // The one property of an account is read even when its name is not the site's: the line names it.
  const property = listed?.find((item) => item.id === propertyId)?.name ?? "";
  const [connectError, setConnectError] = useState<string | null>(null);
  const page = model.data.pages.find((item) =>
    model.data.scope.pageIds.includes(item.id),
  );
  const action = seoAnalyticsAction(analytics, connected, listed?.length ?? 0);
  const line = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLParagraphElement>(null);
  // A connected account with no cause yet has nothing to say: the line waits for one. A sync that runs or
  // failed is said once, by the upkeep line of the verdict card, with its Try again.
  const hidden =
    (analytics === "unknown" && connected) ||
    analytics === "loading" ||
    analytics === "failed";
  const focused = useRef(false);
  const handoff = useRef(false);
  const shownAction = useRef(action);
  // A fix that leaves with its cause (a connect that finished) takes the focus with it: the next cause the line
  // shows gets it, unless the reader put the focus somewhere else in the meantime.
  useEffect(() => {
    if (hidden) {
      handoff.current ||= focused.current;
      focused.current = false;
      return;
    }
    if (shownAction.current === action) return;
    shownAction.current = action;
    const lost =
      document.activeElement === document.body &&
      (focused.current || handoff.current);
    handoff.current = false;
    if (lost) text.current?.focus();
  }, [action, hidden]);
  if (hidden) return null;
  // A status that is not read yet gets the connect button, which shows its wait and its own Try again.
  const control =
    action === "connect" ? (
      <SeoConnectionButton provider="ga4" onError={setConnectError} compact />
    ) : action ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => model.openStatistics("ga4")}
      >
        <Settings2 />
        {action === "manage"
          ? t("manageStatistics")
          : t("agent.chooseProperty")}
      </Button>
    ) : null;
  return (
    <div
      ref={line}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(event) => {
        focused.current = Boolean(
          line.current?.contains(event.relatedTarget as Node | null),
        );
      }}
      className={cn(
        "bg-background flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm",
        // A cause that stops the data stands out: a property to choose.
        analytics === "choose" && "border-chart-2",
      )}
      data-testid="seo-agent-statistics"
    >
      <ChartColumn
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      {/* A failed connect says so in the place of the line's text, in an alert of its own. */}
      {connectError ? (
        <p
          role="alert"
          className="text-destructive min-w-0 flex-1 basis-48 break-words"
        >
          {connectError}
        </p>
      ) : (
        // The cause changes on its own: a screen reader hears the new one.
        <p
          ref={text}
          role="status"
          tabIndex={-1}
          className="min-w-0 flex-1 basis-48 break-words"
        >
          {t("agent.statistics", {
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
