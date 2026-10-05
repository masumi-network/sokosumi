export const AD_RANGES = ["LAST_7_DAYS", "LAST_30_DAYS"] as const;
export type AdRange = (typeof AD_RANGES)[number];

export const AD_CAMPAIGN_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "ENDED",
  "OTHER",
] as const;
export type AdCampaignStatus = (typeof AD_CAMPAIGN_STATUSES)[number];

/** The statuses a user may set; providers report more (see AD_CAMPAIGN_STATUSES). */
export const AD_CAMPAIGN_SETTABLE_STATUSES = ["ACTIVE", "PAUSED"] as const;

/** What a campaign update may change; at least one field is set. */
export interface AdCampaignUpdate {
  status?: (typeof AD_CAMPAIGN_SETTABLE_STATUSES)[number];
  /** Decimal in the account currency. */
  dailyBudget?: number;
}

/** Objectives a new Meta campaign may have. Google Search campaigns have none. */
export const META_CAMPAIGN_OBJECTIVES = [
  "OUTCOME_TRAFFIC",
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
] as const;
export type MetaCampaignObjective = (typeof META_CAMPAIGN_OBJECTIVES)[number];

/** A new campaign. There is no status: campaigns are always created paused. */
export interface AdCampaignCreate {
  name: string;
  /** Decimal in the account currency. */
  dailyBudget: number;
}

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

/** Decimal places of a currency's amounts (JPY 0, USD 2). */
export function currencyFractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** An amount in a currency's smallest unit as a decimal (JPY has none, USD has 100 per unit). */
export function fromMinorUnits(amount: number, currency: string): number {
  return amount / 10 ** currencyFractionDigits(currency);
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
