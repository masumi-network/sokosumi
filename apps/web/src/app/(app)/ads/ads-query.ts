import { AdRange, type ProjectAdAccount } from "@sokosumi/core-client";

export const ADS_TABS = ["campaigns", "market", "accounts"] as const;

/** `?range=` values, kept short for the URL. */
export const RANGE_PARAMS = ["7d", "30d"] as const;
export type RangeParam = (typeof RANGE_PARAMS)[number];

export const CORE_RANGE_BY_PARAM: Record<RangeParam, AdRange> = {
  "7d": AdRange.LAST_7_DAYS,
  "30d": AdRange.LAST_30_DAYS,
};

/** An unknown or missing `?tab=` opens Campaigns, the default tab. */
export function isCampaignsTab(tab: string | undefined): boolean {
  return (
    tab === undefined || tab === "campaigns" || !ADS_TABS.some((t) => t === tab)
  );
}

export interface CampaignsSelection {
  account: ProjectAdAccount;
  range: RangeParam;
}

/**
 * Which account and range the Campaigns tab shows. An unknown `?account=`
 * falls back to the first account and an unknown `?range=` to 30 days, so a
 * stale link still opens something useful. Null when there are no accounts.
 */
export function parseCampaignsSelection(
  query: { account?: string | undefined; range?: string | undefined },
  accounts: readonly ProjectAdAccount[],
): CampaignsSelection | null {
  const account =
    accounts.find(({ id }) => id === query.account) ?? accounts[0];
  if (!account) return null;

  const range = RANGE_PARAMS.find((candidate) => candidate === query.range);
  return { account, range: range ?? "30d" };
}
