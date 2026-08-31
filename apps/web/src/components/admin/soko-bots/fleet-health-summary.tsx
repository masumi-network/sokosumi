import { getTranslations } from "next-intl/server";

import type { AdminSokoBotListItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface FleetHealthSummaryProps {
  items: AdminSokoBotListItem[];
  total: number;
}

const STALE_ERROR_STREAK = 3;

/** Header strip of fleet counters derived from the loaded page. */
export async function FleetHealthSummary({
  items,
  total,
}: FleetHealthSummaryProps) {
  const t = await getTranslations("App.Admin.SokoBots.Health");
  const active = items.filter((item) => item.archivedAt === null);
  const counters = [
    { key: "total", value: total, tone: "" },
    {
      key: "running",
      value: active.filter((item) => item.status === "RUNNING").length,
      tone: "text-semantic-info",
    },
    {
      key: "paused",
      value: active.filter((item) => item.status === "PAUSED").length,
      tone: "text-semantic-warning",
    },
    {
      key: "error",
      value: active.filter(
        (item) =>
          item.status === "ERROR" ||
          item.consecutiveTurnFailures >= STALE_ERROR_STREAK,
      ).length,
      tone: "text-semantic-destructive",
    },
    {
      key: "pendingDecisions",
      value: active.reduce((sum, item) => sum + item.pendingDecisionCount, 0),
      tone: "text-semantic-warning",
    },
    {
      key: "archived",
      value: items.filter((item) => item.archivedAt !== null).length,
      tone: "text-muted-foreground",
    },
  ] as const;

  return (
    <dl className="grid grid-cols-2 divide-x divide-y rounded-md border sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
      {counters.map((counter) => (
        <div key={counter.key} className="space-y-0.5 px-4 py-3">
          <dt className="text-muted-foreground text-xs">{t(counter.key)}</dt>
          <dd
            className={cn(
              "text-xl font-semibold tabular-nums tracking-tight",
              counter.tone,
            )}
          >
            {counter.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
