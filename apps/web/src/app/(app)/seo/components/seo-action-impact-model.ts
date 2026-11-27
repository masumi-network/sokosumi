import type { ProjectSeoActionImpact } from "@sokosumi/core-client";
import { SEO_IMPACT_SETTLE_DAYS, seoImpactPercent } from "@sokosumi/utils";

const DAY_MS = 86_400_000;

export interface SeoActionImpactRow {
  metric: "clicks" | "impressions" | "position";
  before: number | null;
  after: number | null;
  /** Counts only, and only when both are high enough for a percent to mean something. */
  percent: number | null;
}

/**
 * Cached actions with the impact of a fresh read. An action the fresh read does
 * not hold, or holds without impact, keeps what it has.
 */
interface ImpactAction {
  observationId: string;
  id: string;
  completedAt?: Date | string;
  verifiedAt?: Date | string;
  impact?: ProjectSeoActionImpact;
}
const impactKey = (action: ImpactAction) =>
  `${action.observationId}:${action.id}`;

export function withFreshSeoActionImpact<Action extends ImpactAction>(
  cached: Action[],
  fresh: Action[],
): Action[] {
  const impacts = new Map(
    fresh.map((action) => [impactKey(action), action.impact]),
  );
  return cached.map((action) => {
    const impact = impacts.get(impactKey(action));
    return impact ? { ...action, impact } : action;
  });
}

/** A cached done action the fresh read does not hold: its impact can only come from a new read of that view. */
export function missesFreshSeoActionImpact(
  cached: ImpactAction[],
  fresh: ImpactAction[],
): boolean {
  const held = new Set(fresh.map(impactKey));
  return cached.some(
    (action) =>
      (action.completedAt || action.verifiedAt) && !held.has(impactKey(action)),
  );
}

/** The three figures side by side, and the first day a too-early comparison can be read. */
export function seoActionImpactModel(impact: ProjectSeoActionImpact): {
  rows: SeoActionImpactRow[];
  /** A count was read on both sides and is too low for a percent. */
  lowCounts: boolean;
  /** A side has no stored days. A too-early comparison can also lack its before side. */
  notMeasured: boolean;
  readableFrom: string;
} {
  const { before, after } = impact;
  const count = (metric: "clicks" | "impressions"): SeoActionImpactRow => ({
    metric,
    before: before?.[metric] ?? null,
    after: after?.[metric] ?? null,
    percent:
      before && after ? seoImpactPercent(before[metric], after[metric]) : null,
  });
  const counts = [count("clicks"), count("impressions")];
  return {
    rows: [
      ...counts,
      {
        metric: "position",
        before: before?.position ?? null,
        after: after?.position ?? null,
        percent: null,
      },
    ],
    lowCounts:
      Boolean(before && after) && counts.some((row) => row.percent === null),
    notMeasured: impact.state === "not_measured" || !before,
    readableFrom: new Date(
      Date.parse(`${impact.anchor}T00:00:00Z`) +
        (impact.days + SEO_IMPACT_SETTLE_DAYS) * DAY_MS,
    )
      .toISOString()
      .slice(0, 10),
  };
}
