import type { AdminSokoBotListItem } from "@sokosumi/core-client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

interface FleetHealthSummaryProps {
  items: AdminSokoBotListItem[];
}

const RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AttentionReason =
  | { kind: "error" }
  | { kind: "paused" }
  | { kind: "failures"; count: number }
  | { kind: "pending"; count: number };

/** Why a bot needs an operator, or an empty list when it does not. */
export function attentionReasons(
  item: AdminSokoBotListItem,
): AttentionReason[] {
  if (item.archivedAt !== null) return [];
  const reasons: AttentionReason[] = [];
  if (item.status === "ERROR") reasons.push({ kind: "error" });
  if (item.status === "PAUSED") reasons.push({ kind: "paused" });
  if (item.consecutiveTurnFailures > 0) {
    reasons.push({ kind: "failures", count: item.consecutiveTurnFailures });
  }
  if (item.pendingDecisionCount > 0) {
    reasons.push({ kind: "pending", count: item.pendingDecisionCount });
  }
  return reasons;
}

/**
 * The fleet at a glance: four counters, then the bots that need someone.
 * Derived from the loaded page, which holds the whole fleet at today's size.
 */
export async function FleetHealthSummary({ items }: FleetHealthSummaryProps) {
  const t = await getTranslations("App.Admin.SokoBots.Health");
  const active = items.filter((item) => item.archivedAt === null);
  const recentSince = Date.now() - RECENT_DAYS * DAY_MS;
  const attention = active
    .map((item) => ({ item, reasons: attentionReasons(item) }))
    .filter(({ reasons }) => reasons.length > 0);

  const counters = [
    { key: "active", value: active.length, alert: false },
    {
      key: "activeRecently",
      value: active.filter(
        (item) =>
          item.lastActivityAt !== null &&
          new Date(item.lastActivityAt).getTime() >= recentSince,
      ).length,
      alert: false,
    },
    { key: "attention", value: attention.length, alert: attention.length > 0 },
    {
      key: "pendingDecisions",
      value: active.reduce((sum, item) => sum + item.pendingDecisionCount, 0),
      alert: false,
    },
  ] as const;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 divide-x divide-y rounded-md border lg:grid-cols-4 lg:divide-y-0">
        {counters.map((counter) => (
          <div key={counter.key} className="space-y-0.5 px-4 py-3">
            <dt className="text-muted-foreground text-xs">{t(counter.key)}</dt>
            <dd
              className={cn(
                "text-xl font-semibold tabular-nums tracking-tight",
                counter.alert && "text-semantic-destructive",
              )}
            >
              {counter.value}
            </dd>
          </div>
        ))}
      </dl>

      {attention.length > 0 ? (
        <section
          aria-labelledby="fleet-attention"
          className="rounded-md border"
        >
          <h2
            id="fleet-attention"
            className="border-b px-4 py-2 text-sm font-medium"
          >
            {t("attentionTitle")}
          </h2>
          <ul className="divide-y">
            {attention.map(({ item, reasons }) => (
              <li key={item.id}>
                <Link
                  href={`${ADMIN_SOKO_BOTS_ROUTE}/${item.id}`}
                  className="hover:bg-accent flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm transition-colors"
                >
                  <span className="font-medium">
                    {item.name ?? t("unnamed")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {item.owner.email}
                  </span>
                  <span className="text-semantic-destructive ms-auto text-xs">
                    {reasons
                      .map((reason) =>
                        reason.kind === "failures" || reason.kind === "pending"
                          ? t(`reasons.${reason.kind}`, {
                              count: reason.count,
                            })
                          : t(`reasons.${reason.kind}`),
                      )
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
