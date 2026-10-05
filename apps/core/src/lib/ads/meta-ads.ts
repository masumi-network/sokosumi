import { z } from "@hono/zod-openapi";

import {
  type AdsConnectedAccount,
  type AvailableAdAccount,
  parseToolRows,
  toolRows,
  withAdsToolSession,
} from "@/lib/ads/composio-tools";

const GET_AD_ACCOUNTS = "METAADS_GET_AD_ACCOUNTS";
const MAX_AD_ACCOUNTS = 100;

const metaAdAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  currency: z.string().min(1),
  timezone_name: z.string().nullish(),
});

/** Ad accounts the connected Meta user can manage. */
export async function listMetaAdAccounts(
  input: AdsConnectedAccount,
): Promise<AvailableAdAccount[]> {
  const payload = await withAdsToolSession(
    { ...input, provider: "meta_ads", toolSlugs: [GET_AD_ACCOUNTS] },
    (execute) =>
      execute(GET_AD_ACCOUNTS, {
        limit: MAX_AD_ACCOUNTS,
        fields: "id,name,currency,timezone_name",
      }),
  );
  return parseToolRows(
    toolRows(payload, "data"),
    metaAdAccountSchema,
    "list Meta ad accounts",
  ).map((account) => {
    const externalAccountId = account.id.startsWith("act_")
      ? account.id
      : `act_${account.id}`;
    return {
      externalAccountId,
      name: account.name?.trim() || externalAccountId,
      currency: account.currency,
      timeZone: account.timezone_name ?? null,
    };
  });
}
