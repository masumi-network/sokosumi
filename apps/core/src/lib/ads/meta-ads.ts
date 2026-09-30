import { z } from "@hono/zod-openapi";

import { record } from "@/clients/composio.client";
import {
  type AdCampaign,
  type AdCampaignStatus,
  type AdRange,
  buildAdCampaign,
  fromMinorUnits,
  noAdMetrics,
  sumAdMetrics,
} from "@/lib/ads/campaigns";
import {
  type AdsConnectedAccount,
  type AvailableAdAccount,
  type ExecuteAdsTool,
  parseToolRows,
  requireToolRows,
  toolRows,
  withAdsToolSession,
} from "@/lib/ads/composio-tools";
import { tryUseLogger } from "@/lib/evlog";

const GET_AD_ACCOUNTS = "METAADS_GET_AD_ACCOUNTS";
const MAX_AD_ACCOUNTS = 100;
const LIST_CAMPAIGNS = "METAADS_LIST_CAMPAIGNS";
const GET_INSIGHTS = "METAADS_GET_INSIGHTS";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const DATE_PRESETS = {
  LAST_7_DAYS: "last_7d",
  LAST_30_DAYS: "last_30d",
} as const satisfies Record<AdRange, string>;
const META_STATUSES: Record<string, AdCampaignStatus> = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  CAMPAIGN_PAUSED: "PAUSED",
  ARCHIVED: "ENDED",
  COMPLETED: "ENDED",
};

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

const metaCampaignSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.string(),
  status: z.string().nullish(),
  effective_status: z.string().nullish(),
  objective: z.string().nullish(),
  /** Minor currency units. */
  daily_budget: z.coerce.number().nullish(),
});

const metaInsightSchema = z.object({
  campaign_id: z.coerce.string().min(1),
  spend: z.coerce.number().nullish(),
  impressions: z.coerce.number().nullish(),
  clicks: z.coerce.number().nullish(),
});

/** The `after` cursor of the next page, wherever the tool nests Graph's paging. */
function nextCursor(payload: Record<string, unknown> | null): string | null {
  const paging =
    record(payload?.paging) ?? record(record(payload?.data)?.paging);
  const after = record(paging?.cursors)?.after;
  return typeof after === "string" && after ? after : null;
}

/** Every row of a paged tool, at most MAX_PAGES pages; past that it logs and returns what it has. */
async function listAllRows(
  execute: ExecuteAdsTool,
  toolSlug: string,
  args: Record<string, unknown>,
  context: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const payload = await execute(toolSlug, {
      ...args,
      limit: PAGE_SIZE,
      ...(after ? { after } : {}),
    });
    const pageRows = requireToolRows(payload, "data", context);
    rows.push(...pageRows);
    after = nextCursor(payload);
    if (!after || pageRows.length === 0) return rows;
  }
  tryUseLogger()?.warn(`${context} stopped at ${MAX_PAGES} pages`, {
    ads: { toolSlug, pages: MAX_PAGES, rows: rows.length },
  });
  return rows;
}

/** Non-deleted campaigns of an ad account with spend and clicks over the range. Conversions are not reported. */
export async function listMetaCampaigns(
  input: AdsConnectedAccount & {
    adAccountId: string;
    currency: string;
    range: AdRange;
  },
): Promise<AdCampaign[]> {
  const { adAccountId, currency, range, ...connected } = input;
  const [campaignRows, insightRows] = await withAdsToolSession(
    {
      ...connected,
      provider: "meta_ads",
      toolSlugs: [LIST_CAMPAIGNS, GET_INSIGHTS],
    },
    (execute) =>
      Promise.all([
        listAllRows(
          execute,
          LIST_CAMPAIGNS,
          {
            ad_account_id: adAccountId,
            fields: "id,name,status,effective_status,objective,daily_budget",
          },
          "list Meta campaigns",
        ),
        listAllRows(
          execute,
          GET_INSIGHTS,
          {
            object_id: adAccountId,
            level: "campaign",
            fields: "campaign_id,spend,impressions,clicks",
            date_preset: DATE_PRESETS[range],
          },
          "list Meta campaign insights",
        ),
      ]),
  );
  const campaigns = parseToolRows(
    campaignRows,
    metaCampaignSchema,
    "list Meta campaigns",
  );
  const totals = sumAdMetrics(
    parseToolRows(
      insightRows,
      metaInsightSchema,
      "list Meta campaign insights",
    ).map((row) => ({
      campaignId: row.campaign_id,
      spend: row.spend ?? 0,
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      conversions: null,
    })),
  );
  return campaigns
    .filter(
      (campaign) =>
        campaign.status !== "DELETED" &&
        campaign.effective_status !== "DELETED",
    )
    .map((campaign) =>
      buildAdCampaign(
        {
          id: campaign.id,
          name: campaign.name,
          status:
            META_STATUSES[campaign.effective_status ?? campaign.status ?? ""] ??
            "OTHER",
          objective: campaign.objective ?? null,
          dailyBudget:
            campaign.daily_budget == null
              ? null
              : fromMinorUnits(campaign.daily_budget, currency),
        },
        totals.get(campaign.id) ?? noAdMetrics(null),
      ),
    );
}
