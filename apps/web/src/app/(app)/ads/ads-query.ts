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
