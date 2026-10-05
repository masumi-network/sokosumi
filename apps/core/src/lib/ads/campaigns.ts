export const AD_RANGES = ["LAST_7_DAYS", "LAST_30_DAYS"] as const;
export type AdRange = (typeof AD_RANGES)[number];

export const AD_CAMPAIGN_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "ENDED",
  "OTHER",
] as const;
export type AdCampaignStatus = (typeof AD_CAMPAIGN_STATUSES)[number];

export interface AdCampaignMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  /** Null when the provider does not report conversions. */
  conversions: number | null;
}

/** A campaign as both providers report it. Money is a decimal in the account currency. */
export interface AdCampaign extends AdCampaignMetrics {
  id: string;
  name: string;
  status: AdCampaignStatus;
  objective: string | null;
  dailyBudget: number | null;
  /** clicks / impressions; null without impressions. */
  ctr: number | null;
  /** spend / clicks; null without clicks. */
  cpc: number | null;
}

type AdCampaignBase = Pick<
  AdCampaign,
  "id" | "name" | "status" | "objective" | "dailyBudget"
>;

export function noAdMetrics(conversions: number | null): AdCampaignMetrics {
  return { spend: 0, impressions: 0, clicks: 0, conversions };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** An amount in a currency's smallest unit as a decimal (JPY has none, USD has 100 per unit). */
export function fromMinorUnits(amount: number, currency: string): number {
  const { maximumFractionDigits } = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions();
  return amount / 10 ** (maximumFractionDigits ?? 2);
}

/** Totals metrics rows per campaign id. */
export function sumAdMetrics(
  rows: readonly (AdCampaignMetrics & { campaignId: string })[],
): Map<string, AdCampaignMetrics> {
  const totals = new Map<string, AdCampaignMetrics>();
  for (const { campaignId, ...row } of rows) {
    const total =
      totals.get(campaignId) ??
      noAdMetrics(row.conversions === null ? null : 0);
    totals.set(campaignId, {
      spend: total.spend + row.spend,
      impressions: total.impressions + row.impressions,
      clicks: total.clicks + row.clicks,
      conversions:
        total.conversions === null || row.conversions === null
          ? null
          : total.conversions + row.conversions,
    });
  }
  return totals;
}

export function buildAdCampaign(
  base: AdCampaignBase,
  metrics: AdCampaignMetrics,
): AdCampaign {
  const { spend, impressions, clicks, conversions } = metrics;
  return {
    ...base,
    dailyBudget: base.dailyBudget === null ? null : round(base.dailyBudget, 2),
    spend: round(spend, 2),
    impressions,
    clicks,
    ctr: impressions > 0 ? round(clicks / impressions, 4) : null,
    cpc: clicks > 0 ? round(spend / clicks, 2) : null,
    conversions: conversions === null ? null : round(conversions, 2),
  };
}
