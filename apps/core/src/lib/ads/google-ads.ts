import { z } from "@hono/zod-openapi";

import { ComposioToolError } from "@/clients/social-post-providers/tools";
import {
  type AdCampaign,
  type AdCampaignStatus,
  type AdRange,
  buildAdCampaign,
  noAdMetrics,
  sumAdMetrics,
} from "@/lib/ads/campaigns";
import {
  type AdsConnectedAccount,
  type AvailableAdAccount,
  parseToolRows,
  requireToolRows,
  toolRows,
  withAdsToolSession,
} from "@/lib/ads/composio-tools";

const LIST_ACCESSIBLE_CUSTOMERS = "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS";
const SEARCH_STREAM_GAQL = "GOOGLEADS_SEARCH_STREAM_GAQL";
const MAX_CUSTOMERS = 50;
const MICROS = 1_000_000;

const CUSTOMER_QUERY =
  "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1";

const customerRowSchema = z.object({
  customer: z.object({
    id: z.coerce.string().min(1),
    descriptiveName: z.string().nullish(),
    currencyCode: z.string().min(1),
    timeZone: z.string().nullish(),
    manager: z.boolean().nullish(),
  }),
});

/**
 * Customer accounts the connected Google user can open directly. Manager
 * accounts are left out: Composio's Google Ads tools have no
 * `login-customer-id`, so their client accounts are out of reach.
 */
export async function listGoogleAdAccounts(
  input: AdsConnectedAccount,
): Promise<AvailableAdAccount[]> {
  return withAdsToolSession(
    {
      ...input,
      provider: "google_ads",
      toolSlugs: [LIST_ACCESSIBLE_CUSTOMERS, SEARCH_STREAM_GAQL],
    },
    async (execute) => {
      const customerIds = toolRows(
        await execute(LIST_ACCESSIBLE_CUSTOMERS, {}),
        "resourceNames",
      )
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.replace(/^customers\//, ""))
        .slice(0, MAX_CUSTOMERS);

      const accounts = await Promise.all(
        customerIds.map(async (customerId) => {
          try {
            const rows = toolRows(
              await execute(SEARCH_STREAM_GAQL, {
                customer_id: customerId,
                query: CUSTOMER_QUERY,
              }),
              "results",
            );
            const [row] = parseToolRows(
              rows,
              customerRowSchema,
              "describe Google Ads customer",
            );
            const customer = row?.customer;
            if (!customer || customer.manager) return [];
            return [
              {
                externalAccountId: customer.id,
                name:
                  customer.descriptiveName?.trim() || `Account ${customer.id}`,
                currency: customer.currencyCode,
                timeZone: customer.timeZone ?? null,
              },
            ];
          } catch (error) {
            // Google lists customers the user cannot query (cancelled, no access).
            if (error instanceof ComposioToolError) return [];
            throw error;
          }
        }),
      );
      return accounts.flat();
    },
  );
}

// GAQL drops campaigns without metrics when it filters by segments.date, so
// campaigns and metrics are two queries merged by campaign id. Campaigns are
// capped at MAX_CAMPAIGNS.
const MAX_CAMPAIGNS = 1000;
const CAMPAIGNS_QUERY = `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id LIMIT ${MAX_CAMPAIGNS}`;

const METRICS_QUERIES: Record<AdRange, string> = {
  LAST_7_DAYS:
    "SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS AND campaign.status != 'REMOVED'",
  LAST_30_DAYS:
    "SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED'",
};

const campaignRowSchema = z.object({
  campaign: z.object({
    id: z.coerce.string().min(1),
    name: z.string(),
    status: z.string(),
    advertisingChannelType: z.string().nullish(),
    servingStatus: z.string().nullish(),
  }),
  campaignBudget: z
    .object({ amountMicros: z.coerce.number().nullish() })
    .nullish(),
});

const metricRowSchema = z.object({
  campaign: z.object({ id: z.coerce.string().min(1) }),
  metrics: z.object({
    costMicros: z.coerce.number().nullish(),
    impressions: z.coerce.number().nullish(),
    clicks: z.coerce.number().nullish(),
    conversions: z.coerce.number().nullish(),
  }),
});

function googleStatus(
  status: string,
  servingStatus: string | null | undefined,
): AdCampaignStatus {
  if (status === "PAUSED") return "PAUSED";
  if (status !== "ENABLED") return "OTHER";
  return servingStatus === "ENDED" ? "ENDED" : "ACTIVE";
}

/** Non-removed campaigns (up to 1000) of a customer with spend, clicks and conversions over the range. */
export async function listGoogleCampaigns(
  input: AdsConnectedAccount & { customerId: string; range: AdRange },
): Promise<AdCampaign[]> {
  const { customerId, range, ...connected } = input;
  const [campaignPayload, metricPayload] = await withAdsToolSession(
    { ...connected, provider: "google_ads", toolSlugs: [SEARCH_STREAM_GAQL] },
    (execute) =>
      Promise.all(
        [CAMPAIGNS_QUERY, METRICS_QUERIES[range]].map((query) =>
          execute(SEARCH_STREAM_GAQL, { customer_id: customerId, query }),
        ),
      ),
  );
  const campaigns = parseToolRows(
    requireToolRows(
      campaignPayload,
      "results",
      "list Google Ads campaigns",
    ).map(camelizeKeys),
    campaignRowSchema,
    "list Google Ads campaigns",
  );
  const totals = sumAdMetrics(
    parseToolRows(
      requireToolRows(
        metricPayload,
        "results",
        "list Google Ads campaign metrics",
      ).map(camelizeKeys),
      metricRowSchema,
      "list Google Ads campaign metrics",
    ).map((row) => ({
      campaignId: row.campaign.id,
      spend: (row.metrics.costMicros ?? 0) / MICROS,
      impressions: row.metrics.impressions ?? 0,
      clicks: row.metrics.clicks ?? 0,
      conversions: row.metrics.conversions ?? 0,
    })),
  );
  return campaigns.map(({ campaign, campaignBudget }) =>
    buildAdCampaign(
      {
        id: campaign.id,
        name: campaign.name,
        status: googleStatus(campaign.status, campaign.servingStatus),
        objective: campaign.advertisingChannelType ?? null,
        dailyBudget:
          campaignBudget?.amountMicros == null
            ? null
            : campaignBudget.amountMicros / MICROS,
      },
      totals.get(campaign.id) ?? noAdMetrics(0),
    ),
  );
}
