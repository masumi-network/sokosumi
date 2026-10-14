import { AdRange, type ProjectAdAccount } from "@sokosumi/core-client";
import { createLoader, parseAsString, parseAsStringLiteral } from "nuqs/server";

export const ADS_TABS = ["campaigns", "market", "accounts"] as const;

/** `?range=` values, kept short for the URL. */
export const RANGE_PARAMS = ["7d", "30d"] as const;
export type RangeParam = (typeof RANGE_PARAMS)[number];

export const CORE_RANGE_BY_PARAM: Record<RangeParam, AdRange> = {
  "7d": AdRange.LAST_7_DAYS,
  "30d": AdRange.LAST_30_DAYS,
};

/**
 * The page's URL state, read on the server and written by the client. An
 * unknown `?tab=` opens Campaigns and an unknown `?range=` shows 30 days.
 */
export const adsSearchParams = {
  projectId: parseAsString,
  tab: parseAsStringLiteral(ADS_TABS).withDefault("campaigns"),
  account: parseAsString,
  range: parseAsStringLiteral(RANGE_PARAMS).withDefault("30d"),
};

export const loadAdsSearchParams = createLoader(adsSearchParams);

/** The account `?account=` names, or the first one for a stale link. */
export function selectAccount(
  accounts: readonly ProjectAdAccount[],
  accountId: string | null,
): ProjectAdAccount | undefined {
  return accounts.find(({ id }) => id === accountId) ?? accounts[0];
}

/**
 * The Campaigns tab of one account, where the create and details pages lead
 * back to. A `range` is kept when given.
 */
export function campaignsHref(
  projectId: string,
  accountId: string,
  range?: RangeParam,
): string {
  const params = new URLSearchParams({
    projectId,
    tab: "campaigns",
    account: accountId,
    ...(range ? { range } : {}),
  });
  return `/ads?${params}`;
}

/** One Google campaign's details page, over the range the list showed. */
export function campaignDetailsHref(
  projectId: string,
  accountId: string,
  campaignId: string,
  range: RangeParam,
): string {
  return `/ads/campaigns/${encodeURIComponent(campaignId)}?${new URLSearchParams({ projectId, accountId, range })}`;
}

/** The create page's URL state: the project and the account to create in. */
export const loadNewCampaignSearchParams = createLoader({
  projectId: parseAsString,
  accountId: parseAsString,
});

/** The details page's URL state: the project, the account and the range. */
export const loadCampaignDetailsSearchParams = createLoader({
  projectId: parseAsString,
  accountId: parseAsString,
  range: adsSearchParams.range,
});
