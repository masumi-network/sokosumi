import { randomUUID } from "node:crypto";

import { z } from "@hono/zod-openapi";

import {
  projectComposioFetch,
  projectComposioResponse,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { PROJECT_AD_PROVIDERS } from "@/config/ads-providers";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import {
  type AdCampaign,
  type AdCampaignStatus,
  type AdCampaignUpdate,
  type AdRange,
  buildAdCampaign,
  GOOGLE_MAX_IDS,
  GOOGLE_MAX_LOCATION_SUGGESTIONS,
  type GoogleCampaignCreate,
  type GoogleKeyword,
  type GoogleLocationLookup,
  noAdMetrics,
  sumAdMetrics,
} from "@/lib/ads/campaigns";
import {
  type AdsConnectedAccount,
  type AvailableAdAccount,
  parseToolRow,
  parseToolRows,
  requireToolRows,
  toolRows,
  withAdsToolSession,
} from "@/lib/ads/composio-tools";

const LIST_ACCESSIBLE_CUSTOMERS = "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS";
const SEARCH_STREAM_GAQL = "GOOGLEADS_SEARCH_STREAM_GAQL";
const MUTATE_CAMPAIGNS = "GOOGLEADS_MUTATE_CAMPAIGNS";
const MUTATE_CAMPAIGN_BUDGETS = "GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS";
const BATCH_MUTATE = "GOOGLEADS_BATCH_MUTATE";
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
      toolkit: PROJECT_AD_PROVIDERS.google_ads,
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
    {
      ...connected,
      toolkit: PROJECT_AD_PROVIDERS.google_ads,
      toolSlugs: [SEARCH_STREAM_GAQL],
    },
    (execute) =>
      Promise.all(
        [CAMPAIGNS_QUERY, METRICS_QUERIES[range]].map((query) =>
          execute(SEARCH_STREAM_GAQL, { customer_id: customerId, query }),
        ),
      ),
  );
  const campaigns = parseToolRows(
    requireToolRows(campaignPayload, "results", "list Google Ads campaigns"),
    campaignRowSchema,
    "list Google Ads campaigns",
  );
  const totals = sumAdMetrics(
    parseToolRows(
      requireToolRows(
        metricPayload,
        "results",
        "list Google Ads campaign metrics",
      ),
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

const campaignLookupRowSchema = z.object({
  campaign: z.object({ campaignBudget: z.string().min(1) }),
  campaignBudget: z.object({ explicitlyShared: z.boolean().nullish() }),
});

/** A partial failure error that is set and not empty; tools may send `{}` for none. */
function hasPartialFailure(payload: Record<string, unknown> | null): boolean {
  const failure = payload?.partial_failure_error;
  return (
    failure != null &&
    (typeof failure !== "object" || Object.keys(failure).length > 0)
  );
}

/** A mutation that reports no result for its operation, or a partial failure, did not apply. */
function requireMutated(
  payload: Record<string, unknown> | null,
  context: string,
): void {
  if (toolRows(payload, "results").length === 0 || hasPartialFailure(payload)) {
    throw new ComposioToolError({ message: `${context} was not applied` });
  }
}

/**
 * Pauses, resumes and/or changes the daily budget of a campaign of the
 * customer. The campaign is looked up inside the customer first (404 when it
 * is not there), and every refusal happens before the first write. The budget
 * goes first, so a failed status change never follows a silent budget change.
 *
 * Operation shapes follow the tool schemas: campaign operations need
 * `operation_type`, a lowercase status and no `update_mask`; budget
 * operations have an `update_mask` and no `operation_type`.
 */
export async function updateGoogleCampaign(
  input: AdsConnectedAccount &
    AdCampaignUpdate & { customerId: string; campaignId: string },
): Promise<void> {
  const { customerId, campaignId, status, dailyBudget, ...connected } = input;
  if (!/^\d+$/.test(campaignId)) throw notFound("Campaign not found");
  const campaignResourceName = `customers/${customerId}/campaigns/${campaignId}`;
  // The id is digits only, so the query cannot be altered by it.
  const lookupQuery = `SELECT campaign.id, campaign.campaign_budget, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campaignId} AND campaign.status != 'REMOVED'`;

  await withAdsToolSession(
    {
      ...connected,
      toolkit: PROJECT_AD_PROVIDERS.google_ads,
      toolSlugs: [
        SEARCH_STREAM_GAQL,
        MUTATE_CAMPAIGNS,
        MUTATE_CAMPAIGN_BUDGETS,
      ],
    },
    async (execute) => {
      const [row] = parseToolRows(
        requireToolRows(
          await execute(SEARCH_STREAM_GAQL, {
            customer_id: customerId,
            query: lookupQuery,
          }),
          "results",
          "look up Google Ads campaign",
        ),
        campaignLookupRowSchema,
        "look up Google Ads campaign",
      );
      if (!row) throw notFound("Campaign not found");
      if (dailyBudget !== undefined && row.campaignBudget.explicitlyShared) {
        throw conflict(
          "This campaign uses a shared budget; change it in Google Ads",
        );
      }

      if (dailyBudget !== undefined) {
        requireMutated(
          await execute(MUTATE_CAMPAIGN_BUDGETS, {
            customer_id: customerId,
            operations: [
              {
                update: {
                  resource_name: row.campaign.campaignBudget,
                  amount_micros: Math.round(dailyBudget * MICROS),
                },
                update_mask: "amount_micros",
              },
            ],
          }),
          "change Google Ads campaign budget",
        );
      }
      if (status !== undefined) {
        requireMutated(
          await execute(MUTATE_CAMPAIGNS, {
            customer_id: customerId,
            operations: [
              {
                operation_type: "update",
                update: {
                  resource_name: campaignResourceName,
                  status: status === "ACTIVE" ? "enabled" : "paused",
                },
              },
            ],
          }),
          "change Google Ads campaign status",
        );
      }
    },
  );
}

const campaignResultSchema = z.object({
  campaign_result: z.object({
    resource_name: z.string().regex(/^customers\/\d+\/campaigns\/\d+$/),
  }),
});
const MAX_BUDGET_NAME_LENGTH = 255;
const BUDGET_NAME_SUFFIX_LENGTH = " budget ".length + 8;

// Temporary ids link the resources created in one BATCH_MUTATE call.
const BUDGET_TEMP_ID = -1;
const CAMPAIGN_TEMP_ID = -2;
const AD_GROUP_TEMP_ID = -3;

/** Drops keywords that repeat another with the same match type, ignoring case. */
function dedupeGoogleKeywords(
  keywords: readonly GoogleKeyword[],
): GoogleKeyword[] {
  const seen = new Set<string>();
  return keywords.filter(({ text, matchType }) => {
    const key = `${matchType}:${text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The operations of a paused Search campaign: budget, campaign (Maximize
 * clicks, Google Search network only), location and language criteria, one
 * ad group with its keywords and one responsive search ad. Each item has
 * exactly one operation key, as the tool requires.
 */
function searchCampaignOperations(
  customerId: string,
  { name, dailyBudget, google }: GoogleCampaignCreate,
): Record<string, unknown>[] {
  const budget = `customers/${customerId}/campaignBudgets/${BUDGET_TEMP_ID}`;
  const campaign = `customers/${customerId}/campaigns/${CAMPAIGN_TEMP_ID}`;
  const adGroup = `customers/${customerId}/adGroups/${AD_GROUP_TEMP_ID}`;
  // Budget names are unique per customer; the suffix avoids clashes with
  // earlier campaigns of the same name.
  const budgetName = `${name.slice(0, MAX_BUDGET_NAME_LENGTH - BUDGET_NAME_SUFFIX_LENGTH)} budget ${randomUUID().slice(0, 8)}`;
  const criterion = (target: Record<string, unknown>) => ({
    campaign_criterion_operation: { create: { campaign, ...target } },
  });

  return [
    {
      campaign_budget_operation: {
        create: {
          resource_name: budget,
          name: budgetName,
          amount_micros: Math.round(dailyBudget * MICROS),
          delivery_method: "STANDARD",
          explicitly_shared: false,
        },
      },
    },
    {
      campaign_operation: {
        create: {
          resource_name: campaign,
          name,
          status: "PAUSED",
          advertising_channel_type: "SEARCH",
          campaign_budget: budget,
          target_spend: {},
          network_settings: {
            target_google_search: true,
            target_search_network: false,
            target_content_network: false,
          },
          contains_eu_political_advertising:
            "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
          ...(google.startDate && {
            start_date_time: `${google.startDate} 00:00:00`,
          }),
          ...(google.endDate && {
            end_date_time: `${google.endDate} 23:59:59`,
          }),
        },
      },
    },
    ...[...new Set(google.locationIds)].map((id) =>
      criterion({
        location: { geo_target_constant: `geoTargetConstants/${id}` },
      }),
    ),
    ...[...new Set(google.languageIds)].map((id) =>
      criterion({ language: { language_constant: `languageConstants/${id}` } }),
    ),
    {
      ad_group_operation: {
        create: {
          resource_name: adGroup,
          campaign,
          name: "Ad group 1",
          status: "ENABLED",
          type: "SEARCH_STANDARD",
        },
      },
    },
    ...dedupeGoogleKeywords(google.keywords).map(({ text, matchType }) => ({
      ad_group_criterion_operation: {
        create: {
          ad_group: adGroup,
          status: "ENABLED",
          keyword: { text, match_type: matchType },
        },
      },
    })),
    {
      ad_group_ad_operation: {
        create: {
          ad_group: adGroup,
          status: "ENABLED",
          ad: {
            final_urls: [google.finalUrl],
            responsive_search_ad: {
              headlines: google.headlines.map((text) => ({ text })),
              descriptions: google.descriptions.map((text) => ({ text })),
              ...(google.path1 && { path1: google.path1 }),
              ...(google.path2 && { path2: google.path2 }),
            },
          },
        },
      },
    },
  ];
}

// Errors that are not about the request's content stay provider failures.
const NON_VALIDATION_ERROR_CODES = new Set([
  "authenticationerror",
  "authorizationerror",
  "quotaerror",
  "internalerror",
  // Transient: a retry may succeed.
  "concurrentmodificationerror",
  "databaseerror",
]);
// The first entry of `GoogleAdsFailure.errors`. Matched on the text because
// the tool error message is cut at a fixed length, so the JSON may be incomplete.
const GOOGLE_FAILURE_PATTERN =
  /"errors"\s*:\s*\[\s*\{\s*"error_?[cC]ode"\s*:\s*\{\s*"(\w+)"[^}]*\}\s*,\s*"message"\s*:\s*"((?:[^"\\]|\\.)+)"/;

/**
 * Google's first validation or policy message when the tool error carries a
 * `GoogleAdsFailure` ("Too long.", "Destination not working"); null for
 * anything else, including authentication, permission and quota failures.
 */
function googleValidationMessage(error: unknown): string | null {
  if (!(error instanceof ComposioToolError) || !error.providerMessage) {
    return null;
  }
  const [, code, message] =
    GOOGLE_FAILURE_PATTERN.exec(error.providerMessage) ?? [];
  if (!code || !message) return null;
  if (NON_VALIDATION_ERROR_CODES.has(code.replaceAll("_", "").toLowerCase())) {
    return null;
  }
  try {
    return z.string().parse(JSON.parse(`"${message}"`));
  } catch {
    return message;
  }
}

/**
 * Creates a paused Search campaign with its own (not shared) daily budget in
 * ONE atomic `GOOGLEADS_BATCH_MUTATE` call (`partial_failure: false`): either
 * the whole tree exists afterwards or nothing does. Returns the campaign id.
 * A Google validation or policy failure is raised as 422 with Google's
 * message; other failures are raised unchanged.
 */
export async function createGoogleCampaign(
  input: AdsConnectedAccount & GoogleCampaignCreate & { customerId: string },
): Promise<string> {
  const { customerId, connectedAccountId, executorUserId } = input;

  const payload = await withAdsToolSession(
    {
      connectedAccountId,
      executorUserId,
      toolkit: PROJECT_AD_PROVIDERS.google_ads,
      toolSlugs: [BATCH_MUTATE],
    },
    async (execute) => {
      try {
        return await execute(BATCH_MUTATE, {
          customer_id: customerId,
          partial_failure: false,
          mutate_operations: searchCampaignOperations(customerId, input),
        });
      } catch (error) {
        const message = googleValidationMessage(error);
        throw message ? unprocessableEntity(message) : error;
      }
    },
  );
  const campaignResourceName = toolRows(
    payload,
    "mutate_operation_responses",
  ).flatMap((response) => {
    const parsed = campaignResultSchema.safeParse(response);
    return parsed.success ? [parsed.data.campaign_result.resource_name] : [];
  })[0];
  if (hasPartialFailure(payload) || !campaignResourceName) {
    throw new ComposioToolError({
      message: "create Google Ads campaign was not applied",
    });
  }
  return campaignResourceName.slice(campaignResourceName.lastIndexOf("/") + 1);
}

export interface GoogleLocation {
  id: string;
  name: string;
  canonicalName: string;
  targetType: string | null;
  countryCode: string | null;
}

export interface GoogleLanguage {
  id: string;
  code: string;
  name: string;
}

const LANGUAGES_QUERY =
  "SELECT language_constant.id, language_constant.code, language_constant.name FROM language_constant WHERE language_constant.targetable = TRUE";
const GEO_TARGET_SUGGEST_ENDPOINT =
  "https://googleads.googleapis.com/v23/geoTargetConstants:suggest";

const languageRowSchema = z.object({
  languageConstant: z.object({
    id: z.coerce.string().min(1),
    code: z.string(),
    name: z.string(),
  }),
});

const proxyResponseSchema = z.object({ status: z.number(), data: z.unknown() });
const googleErrorSchema = z.object({
  error: z.object({ message: z.string() }),
});

/**
 * Calls a Google Ads REST endpoint through the Composio proxy with the
 * connected account's credentials. A status outside 2xx is a provider error.
 */
async function callGoogleAds(
  connectedAccountId: string,
  endpoint: string,
  body: Record<string, unknown>,
  context: string,
): Promise<unknown> {
  const response = await projectComposioFetch("/api/v3/tools/execute/proxy", {
    method: "POST",
    jsonBody: {
      connected_account_id: connectedAccountId,
      endpoint,
      method: "POST",
      body,
    },
  });
  const { status, data } = parseToolRow(
    await projectComposioResponse<unknown>(response, context),
    proxyResponseSchema,
    context,
  );
  if (status < 200 || status >= 300) {
    throw new ComposioToolError({
      message: "Google Ads refused the request",
      providerStatus: status,
      providerMessage: googleErrorSchema.safeParse(data).data?.error.message,
    });
  }
  return data;
}

// Google omits empty lists and fields. Suggestions that are not ENABLED are
// dropped (null) by the caller.
const locationSuggestionSchema = z
  .object({
    geoTargetConstant: z.object({
      id: z.coerce.string().min(1),
      status: z.string().nullish(),
      name: z.string(),
      canonicalName: z.string(),
      targetType: z.string().nullable().default(null),
      countryCode: z.string().nullable().default(null),
    }),
  })
  .transform(({ geoTargetConstant: { status, ...location } }) =>
    status === "ENABLED" ? location : null,
  );

const locationSuggestionsSchema = z.object({
  geoTargetConstantSuggestions: z.array(locationSuggestionSchema).default([]),
});

/**
 * Enabled Google locations from Google's `geoTargetConstants:suggest`: for a
 * name `q`, a page of suggestions (case-insensitive, ranked by Google), or
 * for 1-25 geo target constant `ids`, all of them that exist. It is not
 * scoped to a customer, so any connected Google login can ask.
 */
export async function searchGoogleLocations(
  input: AdsConnectedAccount & GoogleLocationLookup,
): Promise<GoogleLocation[]> {
  if (
    "ids" in input &&
    !(input.ids.length >= 1 && input.ids.length <= GOOGLE_MAX_IDS)
  ) {
    throw unprocessableEntity(`Send 1-${GOOGLE_MAX_IDS} location ids`);
  }
  const context = "suggest Google Ads locations";
  const data = await callGoogleAds(
    input.connectedAccountId,
    GEO_TARGET_SUGGEST_ENDPOINT,
    {
      locale: "en",
      ...("q" in input
        ? { locationNames: { names: [input.q] } }
        : {
            geoTargets: {
              geoTargetConstants: input.ids.map(
                (id) => `geoTargetConstants/${id}`,
              ),
            },
          }),
    },
    context,
  );
  const locations = parseToolRow(
    data,
    locationSuggestionsSchema,
    context,
  ).geoTargetConstantSuggestions.filter((location) => location !== null);
  const unique = locations.filter(
    (location, i) => locations.findIndex((l) => l.id === location.id) === i,
  );
  return "q" in input
    ? unique.slice(0, GOOGLE_MAX_LOCATION_SUGGESTIONS)
    : unique;
}

/** Languages a Google campaign can target, sorted by name. */
export async function listGoogleLanguages(
  input: AdsConnectedAccount & { customerId: string },
): Promise<GoogleLanguage[]> {
  const { customerId, ...connected } = input;
  const payload = await withAdsToolSession(
    {
      ...connected,
      toolkit: PROJECT_AD_PROVIDERS.google_ads,
      toolSlugs: [SEARCH_STREAM_GAQL],
    },
    (execute) =>
      execute(SEARCH_STREAM_GAQL, {
        customer_id: customerId,
        query: LANGUAGES_QUERY,
      }),
  );
  return parseToolRows(
    requireToolRows(payload, "results", "list Google Ads languages"),
    languageRowSchema,
    "list Google Ads languages",
  )
    .map(({ languageConstant }) => languageConstant)
    .sort((a, b) => a.name.localeCompare(b.name));
}
