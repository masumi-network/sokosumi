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

/** Objectives a new Meta campaign may have. Google campaigns have none. */
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

export const GOOGLE_KEYWORD_MATCH_TYPES = ["BROAD", "PHRASE", "EXACT"] as const;
export type GoogleKeywordMatchType =
  (typeof GOOGLE_KEYWORD_MATCH_TYPES)[number];

export interface GoogleKeyword {
  text: string;
  matchType: GoogleKeywordMatchType;
}

/** Geo target or language constant ids one request names at most. */
export const GOOGLE_MAX_IDS = 25;

/** Locations one name search returns at most. */
export const GOOGLE_MAX_LOCATION_SUGGESTIONS = 20;

/** Find Google locations by name, or look them up by geo target constant id. */
export type GoogleLocationLookup = { q: string } | { ids: string[] };

interface GoogleCampaignSpecBase {
  /** `YYYY-MM-DD`, the account's time zone. */
  startDate?: string;
  /** `YYYY-MM-DD`, not before startDate. */
  endDate?: string;
  /** Geo target constant ids; none targets all countries. */
  locationIds: string[];
  /** Language constant ids; none targets all languages. */
  languageIds: string[];
  finalUrl: string;
}

/** Most sitelinks and callouts a Search campaign has, and the longest texts (Google's limits). */
export const GOOGLE_MAX_SITELINKS = 8;
export const GOOGLE_MAX_CALLOUTS = 10;
export const GOOGLE_MAX_SITELINK_TEXT = 25;
export const GOOGLE_MAX_SITELINK_DESCRIPTION = 35;
export const GOOGLE_MAX_CALLOUT_TEXT = 25;

export interface GoogleSitelink {
  text: string;
  finalUrl: string;
  /** Both descriptions or neither. */
  description1?: string;
  description2?: string;
}

export interface GoogleSearchCampaignSpec extends GoogleCampaignSpecBase {
  type: "SEARCH";
  keywords: GoogleKeyword[];
  headlines: string[];
  descriptions: string[];
  path1?: string;
  path2?: string;
  sitelinks?: GoogleSitelink[];
  callouts?: string[];
}

/** What a new Google campaign contains beyond its name and budget; one member per campaign type. */
export type GoogleCampaignSpec = GoogleSearchCampaignSpec;

export interface GoogleCampaignCreate extends AdCampaignCreate {
  google: GoogleCampaignSpec;
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
