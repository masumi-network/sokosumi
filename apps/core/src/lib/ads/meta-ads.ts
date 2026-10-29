import { z } from "@hono/zod-openapi";

import { record } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { PROJECT_AD_PROVIDERS } from "@/config/ads-providers";
import { conflict, notFound } from "@/helpers/error";
import {
  type AdCampaign,
  type AdCampaignCreate,
  type AdCampaignStatus,
  type AdCampaignUpdate,
  type AdRange,
  buildAdCampaign,
  completeDaysRange,
  fromMinorUnits,
  type MetaCampaignObjective,
  noAdMetrics,
  sumAdMetrics,
} from "@/lib/ads/campaigns";
import {
  type AdsConnectedAccount,
  type AvailableAdAccount,
  type ExecuteAdsTool,
  parseToolRow,
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
const GET_OBJECT = "METAADS_GET_OBJECT";
const UPDATE_CAMPAIGN = "METAADS_UPDATE_CAMPAIGN";
const CREATE_CAMPAIGN = "METAADS_CREATE_CAMPAIGN";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const META_STATUSES: Record<string, AdCampaignStatus> = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  CAMPAIGN_PAUSED: "PAUSED",
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
    {
      ...input,
      toolkit: PROJECT_AD_PROVIDERS.meta_ads,
      toolSlugs: [GET_AD_ACCOUNTS],
    },
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
    const externalAccountId = actAccountId(account.id);
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

/** Insights `conversions` is a number or a list of `{ value }` rows. */
const metaConversionsSchema = z
  .union([z.coerce.number(), z.array(z.object({ value: z.coerce.number() }))])
  .nullish()
  .transform((value) => {
    if (value == null) return 0;
    if (typeof value === "number") return value;
    return value.reduce((sum, row) => sum + row.value, 0);
  });

const metaInsightSchema = z.object({
  campaign_id: z.coerce.string().min(1),
  spend: z.coerce.number().nullish(),
  impressions: z.coerce.number().nullish(),
  clicks: z.coerce.number().nullish(),
  conversions: metaConversionsSchema,
});

/** The `after` cursor of the next page. */
function nextCursor(payload: Record<string, unknown> | null): string | null {
  const after = record(record(payload?.paging)?.cursors)?.after;
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

/**
 * Campaigns of an ad account with spend, clicks and conversions over the
 * range. Meta only returns archived and deleted campaigns when asked, which
 * we do not. The metrics window is complete UTC days excluding today, matching
 * the Google Ads `LAST_*_DAYS` presets.
 */
export async function listMetaCampaigns(
  input: AdsConnectedAccount & {
    adAccountId: string;
    currency: string;
    range: AdRange;
  },
): Promise<AdCampaign[]> {
  const { adAccountId, currency, range, ...connected } = input;
  const timeRange = completeDaysRange(range);
  const [campaignRows, insightRows] = await withAdsToolSession(
    {
      ...connected,
      toolkit: PROJECT_AD_PROVIDERS.meta_ads,
      toolSlugs: [LIST_CAMPAIGNS, GET_INSIGHTS],
    },
    (execute) =>
      Promise.all([
        listAllRows(
          execute,
          LIST_CAMPAIGNS,
          {
            ad_account_id: adAccountId,
            fields: [
              "id",
              "name",
              "status",
              "effective_status",
              "objective",
              "daily_budget",
            ],
          },
          "list Meta campaigns",
        ),
        listAllRows(
          execute,
          GET_INSIGHTS,
          {
            object_id: adAccountId,
            // Graph aggregates an `act_` object's insights per campaign at this
            // level. Verify against a live account.
            level: "campaign",
            fields: [
              "campaign_id",
              "spend",
              "impressions",
              "clicks",
              "conversions",
            ],
            // Explicit window so Meta matches Google's complete-days presets
            // instead of a relative `date_preset` that can include today.
            time_range: timeRange,
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
      conversions: row.conversions,
    })),
  );
  return campaigns.map((campaign) =>
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
      totals.get(campaign.id) ?? noAdMetrics(0),
    ),
  );
}

// Only campaigns have an objective; an ad set or ad does not.
const metaCampaignOwnerSchema = z.object({
  account_id: z.coerce.string().min(1),
  objective: z.string().min(1).nullish(),
  /** Smallest currency unit; absent when the budget is on the ad sets. */
  daily_budget: z.coerce.number().nullish(),
});

const metaSuccessSchema = z.object({ success: z.literal(true) });

/** Meta ad account id in its `act_…` form, however it was given. */
function actAccountId(adAccountId: string): string {
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

/**
 * A campaign of the attached ad account, or 404: Meta's tools take only a
 * campaign id, so ownership is checked before any write.
 */
async function lookUpMetaCampaign(
  execute: ExecuteAdsTool,
  adAccountId: string,
  campaignId: string,
) {
  const campaign = parseToolRow(
    await execute(GET_OBJECT, {
      object_id: campaignId,
      fields: ["id", "account_id", "objective", "daily_budget"],
    }),
    metaCampaignOwnerSchema,
    "look up Meta campaign",
  );
  if (
    !campaign.objective ||
    actAccountId(campaign.account_id) !== actAccountId(adAccountId)
  ) {
    throw notFound("Campaign not found");
  }
  return campaign;
}

/**
 * Pauses, resumes and/or changes the daily budget of a campaign. The update
 * tool takes only a campaign id, so the object is read first: it must be a
 * campaign (it has an `objective`) of the attached ad account, else 404. Every
 * refusal happens before the write, which is one call carrying both fields.
 *
 * The write tool takes `daily_budget` as a decimal in the account currency,
 * while the campaign read returns it in the smallest currency unit.
 */
export async function updateMetaCampaign(
  input: AdsConnectedAccount &
    AdCampaignUpdate & { adAccountId: string; campaignId: string },
): Promise<void> {
  const { adAccountId, campaignId, status, dailyBudget, ...connected } = input;

  await withAdsToolSession(
    {
      ...connected,
      toolkit: PROJECT_AD_PROVIDERS.meta_ads,
      toolSlugs: [GET_OBJECT, UPDATE_CAMPAIGN],
    },
    async (execute) => {
      const campaign = await lookUpMetaCampaign(
        execute,
        adAccountId,
        campaignId,
      );
      if (dailyBudget !== undefined && !campaign.daily_budget) {
        throw conflict("This campaign's budget is set on its ad sets");
      }

      const result = await execute(UPDATE_CAMPAIGN, {
        campaign_id: campaignId,
        ...(status !== undefined ? { status } : {}),
        ...(dailyBudget !== undefined ? { daily_budget: dailyBudget } : {}),
      });
      if (!metaSuccessSchema.safeParse(result).success) {
        throw new ComposioToolError({
          message: "update Meta campaign was not applied",
        });
      }
    },
  );
}

/**
 * Deletes a campaign by setting its status to DELETED through the update path.
 * The object is read first, as for an update: it must be a campaign of the
 * attached ad account, else 404. That is the only refusal point; the write is
 * one call.
 */
export async function deleteMetaCampaign(
  input: AdsConnectedAccount & { adAccountId: string; campaignId: string },
): Promise<void> {
  const { adAccountId, campaignId, ...connected } = input;

  await withAdsToolSession(
    {
      ...connected,
      toolkit: PROJECT_AD_PROVIDERS.meta_ads,
      toolSlugs: [GET_OBJECT, UPDATE_CAMPAIGN],
    },
    async (execute) => {
      await lookUpMetaCampaign(execute, adAccountId, campaignId);

      const result = await execute(UPDATE_CAMPAIGN, {
        campaign_id: campaignId,
        status: "DELETED",
      });
      if (!metaSuccessSchema.safeParse(result).success) {
        throw new ComposioToolError({
          message: "delete Meta campaign was not applied",
        });
      }
    },
  );
}

const createResultSchema = z.object({
  id: z.string().min(1),
  success: z.literal(true),
});

/**
 * Creates a paused campaign with a daily budget and returns its id. The tool
 * takes `daily_budget` as a decimal in the account currency, and the campaign
 * never has a special ad category.
 */
export async function createMetaCampaign(
  input: AdsConnectedAccount &
    AdCampaignCreate & {
      adAccountId: string;
      objective: MetaCampaignObjective;
    },
): Promise<string> {
  const { adAccountId, name, dailyBudget, objective, ...connected } = input;

  return withAdsToolSession(
    {
      ...connected,
      toolkit: PROJECT_AD_PROVIDERS.meta_ads,
      toolSlugs: [CREATE_CAMPAIGN],
    },
    async (execute) => {
      const result = await execute(CREATE_CAMPAIGN, {
        account_id: actAccountId(adAccountId),
        name,
        objective,
        status: "PAUSED",
        daily_budget: dailyBudget,
        special_ad_categories: [],
      });
      if (result?.success === false) {
        throw new ComposioToolError({
          message: "create Meta campaign was not applied",
        });
      }
      return parseToolRow(result, createResultSchema, "create Meta campaign")
        .id;
    },
  );
}
