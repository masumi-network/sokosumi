import { randomUUID } from "node:crypto";

import { z } from "@hono/zod-openapi";

import {
  projectComposioFetch,
  projectComposioResponse,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { PROJECT_AD_PROVIDERS } from "@/config/ads-providers";
import {
  DriveFileDownloadError,
  downloadDriveFile,
} from "@/helpers/drive-file-download";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import {
  type AdCampaign,
  type AdCampaignCreate,
  type AdCampaignStatus,
  type AdCampaignUpdate,
  type AdRange,
  buildAdCampaign,
  GOOGLE_DISPLAY_IMAGE_MAX_BYTES,
  GOOGLE_DISPLAY_IMAGE_MAX_LABEL,
  GOOGLE_DISPLAY_IMAGE_MIME_TYPES,
  GOOGLE_KEYWORD_MATCH_TYPES,
  GOOGLE_MAX_IDS,
  GOOGLE_MAX_LOCATION_SUGGESTIONS,
  type GoogleCampaignCreate,
  type GoogleCampaignSpec,
  type GoogleDisplayCampaignSpec,
  type GoogleDisplayImage,
  type GoogleDisplayImageRole,
  type GoogleKeyword,
  type GoogleKeywordMatchType,
  type GoogleLocationLookup,
  type GoogleSearchCampaignSpec,
  noAdMetrics,
  round,
  sumAdMetrics,
  summarizeAdMetrics,
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
// Sitelink and callout assets count down from here.
const FIRST_ASSET_TEMP_ID = -10;

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

/** What differs between campaign types in the common operations. */
const CHANNELS = {
  SEARCH: {
    adGroupType: "SEARCH_STANDARD",
    // Google Search network only.
    networkSettings: {
      target_google_search: true,
      target_search_network: false,
      target_content_network: false,
    },
  },
  // Display Network: Google's default network settings.
  DISPLAY: { adGroupType: "DISPLAY_STANDARD", networkSettings: undefined },
} as const;

/** At most `max` code points, so a surrogate pair is never split. */
function truncate(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/**
 * The operations every paused campaign starts with: budget, campaign, location
 * and language criteria, and one ad group. `campaign` and `adGroup` are the
 * temporary resource names the rest of the tree links to. Each item has
 * exactly one operation key, as the tool requires.
 */
function campaignOperations(
  customerId: string,
  { name, dailyBudget }: AdCampaignCreate,
  google: GoogleCampaignSpec,
): {
  campaign: string;
  adGroup: string;
  operations: Record<string, unknown>[];
} {
  const channel = CHANNELS[google.type];
  const budget = `customers/${customerId}/campaignBudgets/${BUDGET_TEMP_ID}`;
  const campaign = `customers/${customerId}/campaigns/${CAMPAIGN_TEMP_ID}`;
  const adGroup = `customers/${customerId}/adGroups/${AD_GROUP_TEMP_ID}`;
  // Budget names are unique per customer; the suffix avoids clashes with
  // earlier campaigns of the same name.
  const budgetName = `${truncate(name, MAX_BUDGET_NAME_LENGTH - BUDGET_NAME_SUFFIX_LENGTH)} budget ${randomUUID().slice(0, 8)}`;
  const criterion = (target: Record<string, unknown>) => ({
    campaign_criterion_operation: { create: { campaign, ...target } },
  });
  return {
    campaign,
    adGroup,
    operations: [
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
            advertising_channel_type: google.type,
            campaign_budget: budget,
            target_spend: {},
            ...(channel.networkSettings && {
              network_settings: channel.networkSettings,
            }),
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
        criterion({
          language: { language_constant: `languageConstants/${id}` },
        }),
      ),
      {
        ad_group_operation: {
          create: {
            resource_name: adGroup,
            campaign,
            name: "Ad group 1",
            status: "ENABLED",
            type: channel.adGroupType,
          },
        },
      },
    ],
  };
}

/**
 * The operations of a paused Search campaign (Maximize clicks, Google Search
 * network only): the common operations, the keywords and one responsive
 * search ad, then the sitelink and callout assets with their campaign links.
 */
function searchCampaignOperations(
  customerId: string,
  create: AdCampaignCreate,
  google: GoogleSearchCampaignSpec,
): Record<string, unknown>[] {
  const { campaign, adGroup, operations } = campaignOperations(
    customerId,
    create,
    google,
  );
  // Assets first, then their links: a link names its asset's temporary id.
  const assets = [
    ...(google.sitelinks ?? []).map(
      ({ text, finalUrl, description1, description2 }) => ({
        fieldType: "SITELINK",
        asset: {
          final_urls: [finalUrl],
          sitelink_asset: {
            link_text: text,
            ...(description1 && { description1 }),
            ...(description2 && { description2 }),
          },
        },
      }),
    ),
    ...(google.callouts ?? []).map((text) => ({
      fieldType: "CALLOUT",
      asset: { callout_asset: { callout_text: text } },
    })),
  ].map((item, index) => ({
    ...item,
    resourceName: `customers/${customerId}/assets/${FIRST_ASSET_TEMP_ID - index}`,
  }));

  return [
    ...operations,
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
    ...assets.map(({ resourceName, asset }) => ({
      asset_operation: { create: { resource_name: resourceName, ...asset } },
    })),
    ...assets.map(({ resourceName, fieldType }) => ({
      campaign_asset_operation: {
        create: { campaign, asset: resourceName, field_type: fieldType },
      },
    })),
  ];
}

/** An image already uploaded to the customer, with the slot it fills. */
interface UploadedDisplayImage {
  role: GoogleDisplayImageRole;
  resourceName: string;
}

/**
 * The operations of a paused Display campaign (Maximize clicks, Display
 * Network): the common operations and one responsive display ad that uses the
 * already uploaded image assets.
 */
function displayCampaignOperations(
  customerId: string,
  create: AdCampaignCreate,
  google: GoogleDisplayCampaignSpec,
  images: readonly UploadedDisplayImage[],
): Record<string, unknown>[] {
  const { adGroup, operations } = campaignOperations(
    customerId,
    create,
    google,
  );
  const assets = (role: GoogleDisplayImageRole) =>
    images
      .filter((image) => image.role === role)
      .map(({ resourceName }) => ({ asset: resourceName }));
  // Our LOGO is a square (1:1) logo; `logo_images` is for 4:1 landscape ones.
  const squareLogos = assets("LOGO");
  return [
    ...operations,
    {
      ad_group_ad_operation: {
        create: {
          ad_group: adGroup,
          status: "ENABLED",
          ad: {
            final_urls: [google.finalUrl],
            responsive_display_ad: {
              marketing_images: assets("LANDSCAPE"),
              square_marketing_images: assets("SQUARE"),
              ...(squareLogos.length > 0 && {
                square_logo_images: squareLogos,
              }),
              headlines: google.headlines.map((text) => ({ text })),
              long_headline: { text: google.longHeadline },
              descriptions: google.descriptions.map((text) => ({ text })),
              business_name: google.businessName,
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

const IMAGE_DOWNLOAD_TIMEOUT_MS = 20_000;
// An image is up to 5 MB, base64-encoded and forwarded to Google.
const IMAGE_UPLOAD_TIMEOUT_MS = 60_000;
const MAX_ASSET_NAME_LENGTH = 128;
const ASSET_NAME_SUFFIX_LENGTH = 1 + 8;

const assetResultSchema = z.object({
  asset_result: z.object({
    resource_name: z.string().regex(/^customers\/\d+\/assets\/\d+$/),
  }),
});

interface DownloadedDisplayImage {
  image: GoogleDisplayImage;
  bytes: Uint8Array;
}

const DISPLAY_IMAGE_MIME_TYPES = new Set<string>(
  GOOGLE_DISPLAY_IMAGE_MIME_TYPES,
);

/**
 * Fetches a Drive image through the SSRF guard. The file must still be there
 * (2xx), fit Google's size limit and be served as JPEG, PNG or GIF; anything
 * else is 422 naming the file.
 */
async function downloadDisplayImage(
  image: GoogleDisplayImage,
): Promise<DownloadedDisplayImage> {
  try {
    const { bytes } = await downloadDriveFile(image.fileUrl, {
      maxBytes: GOOGLE_DISPLAY_IMAGE_MAX_BYTES,
      timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
      acceptsMimeType: (mimeType) => DISPLAY_IMAGE_MIME_TYPES.has(mimeType),
    });
    return { image, bytes };
  } catch (error) {
    if (!(error instanceof DriveFileDownloadError)) throw error;
    switch (error.reason) {
      case "too_large":
        throw unprocessableEntity(
          `Image "${image.name}" is larger than ${GOOGLE_DISPLAY_IMAGE_MAX_LABEL}`,
        );
      case "unavailable":
        throw unprocessableEntity(
          `Image "${image.name}" is no longer available`,
        );
      case "wrong_type":
        throw unprocessableEntity(
          `Image "${image.name}" is not a JPEG, PNG or GIF image`,
        );
    }
  }
}

/**
 * Uploads one image as an IMAGE asset in a call of its own (a call carrying
 * every image would be huge) and returns the asset's resource name. A Google
 * validation failure (aspect ratio, size) is 422 naming the file.
 */
async function uploadDisplayImage(
  execute: ExecuteAdsTool,
  customerId: string,
  { image, bytes }: DownloadedDisplayImage,
): Promise<UploadedDisplayImage> {
  // Asset names are unique per customer; the suffix avoids clashes with
  // earlier uploads of a file of the same name.
  const name = `${truncate(image.name, MAX_ASSET_NAME_LENGTH - ASSET_NAME_SUFFIX_LENGTH)} ${randomUUID().slice(0, 8)}`;
  let payload: Record<string, unknown> | null;
  try {
    payload = await execute(
      BATCH_MUTATE,
      {
        customer_id: customerId,
        partial_failure: false,
        mutate_operations: [
          {
            asset_operation: {
              create: {
                name,
                type: "IMAGE",
                image_asset: { data: Buffer.from(bytes).toString("base64") },
              },
            },
          },
        ],
      },
      { timeoutMs: IMAGE_UPLOAD_TIMEOUT_MS },
    );
  } catch (error) {
    const message = googleValidationMessage(error);
    throw message
      ? unprocessableEntity(`Image "${image.name}": ${message}`)
      : error;
  }
  const parsed = assetResultSchema.safeParse(
    toolRows(payload, "mutate_operation_responses")[0],
  );
  if (hasPartialFailure(payload) || !parsed.success) {
    throw new ComposioToolError({
      message: "upload Google Ads image was not applied",
    });
  }
  return {
    role: image.role,
    resourceName: parsed.data.asset_result.resource_name,
  };
}

/**
 * Creates a paused Search or Display campaign with its own (not shared) daily
 * budget in ONE atomic `GOOGLEADS_BATCH_MUTATE` call (`partial_failure:
 * false`): either the whole tree exists afterwards or nothing does. Returns
 * the campaign id. A Google validation or policy failure is raised as 422
 * with Google's message; other failures are raised unchanged.
 *
 * Display images come first: they are all downloaded (so a bad file fails
 * before anything is written), then uploaded as image assets, one call each.
 * Google cannot remove assets, so images uploaded before a failed tree stay
 * unused in the account; the failure is raised, not retried.
 */
export async function createGoogleCampaign(
  input: AdsConnectedAccount & GoogleCampaignCreate & { customerId: string },
): Promise<string> {
  const { customerId, connectedAccountId, executorUserId, google } = input;

  const downloads: DownloadedDisplayImage[] = [];
  if (google.type === "DISPLAY") {
    for (const image of google.images) {
      downloads.push(await downloadDisplayImage(image));
    }
  }

  const payload = await withAdsToolSession(
    {
      connectedAccountId,
      executorUserId,
      toolkit: PROJECT_AD_PROVIDERS.google_ads,
      toolSlugs: [BATCH_MUTATE],
    },
    async (execute) => {
      let operations: Record<string, unknown>[];
      if (google.type === "DISPLAY") {
        const uploaded: UploadedDisplayImage[] = [];
        for (const download of downloads) {
          uploaded.push(
            await uploadDisplayImage(execute, customerId, download),
          );
        }
        operations = displayCampaignOperations(
          customerId,
          input,
          google,
          uploaded,
        );
      } else {
        operations = searchCampaignOperations(customerId, input, google);
      }
      try {
        return await execute(BATCH_MUTATE, {
          customer_id: customerId,
          partial_failure: false,
          mutate_operations: operations,
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

export type GoogleCampaignType = "SEARCH" | "DISPLAY" | "OTHER";
export type GoogleCampaignNotEditableReason = "TYPE" | "AD_GROUPS" | "AD_TYPE";

export interface GoogleCampaignKeyword {
  id: string;
  text: string;
  matchType: GoogleKeywordMatchType;
  status: string;
  approvalStatus: string | null;
}

export interface GoogleCampaignAd {
  id: string;
  status: string;
  approvalStatus: string | null;
  reviewStatus: string | null;
  adStrength: string | null;
  /** The first final URL; empty without one. */
  finalUrl: string;
  search?: {
    headlines: string[];
    descriptions: string[];
    path1: string | null;
    path2: string | null;
  };
  display?: {
    businessName: string;
    headlines: string[];
    longHeadline: string;
    descriptions: string[];
    images: {
      assetId: string;
      role: GoogleDisplayImageRole;
      url: string;
      width: number;
      height: number;
    }[];
  };
}

export interface GoogleCampaignDetails {
  campaign: {
    id: string;
    name: string;
    status: AdCampaignStatus;
    type: GoogleCampaignType;
    /** Google's `advertising_channel_type`. */
    channelType: string;
    dailyBudget: number;
    currency: string;
    biddingStrategyType: string;
    /** `YYYY-MM-DD`, the customer's time zone; null when not set. */
    startDate: string | null;
    endDate: string | null;
    /** The start date is today or earlier in the customer's time zone. */
    started: boolean;
    /** One ad group with one ad of the campaign type's responsive format. */
    editable: boolean;
    notEditableReason: GoogleCampaignNotEditableReason | null;
  };
  targeting: {
    /** None targets all countries. */
    locations: {
      id: string;
      name: string;
      canonicalName: string;
      targetType: string;
      countryCode: string;
    }[];
    /** None targets all languages. */
    languages: { id: string; name: string }[];
  };
  keywords: GoogleCampaignKeyword[];
  /** The campaign's only ad; null when it has none or several. */
  ad: GoogleCampaignAd | null;
  sitelinks: {
    assetId: string;
    text: string;
    finalUrl: string;
    description1: string | null;
    description2: string | null;
    approvalStatus: string | null;
  }[];
  callouts: {
    assetId: string;
    text: string;
    approvalStatus: string | null;
  }[];
  performance: {
    totals: ReturnType<typeof summarizeAdMetrics>;
    /** Every day of the range, oldest first. */
    daily: {
      date: string;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
    }[];
  };
}

const MS_PER_DAY = 86_400_000;
// Google reports this end date for a campaign without one.
const NO_END_DATE = "2037-12-30";

const textAssetsSchema = z
  .array(z.object({ text: z.string() }))
  .nullish()
  .transform((assets) => (assets ?? []).map(({ text }) => text));
const imageAssetsSchema = z
  .array(z.object({ asset: z.string() }))
  .nullish()
  .transform((assets) => (assets ?? []).map(({ asset }) => asset));

const detailCampaignRowSchema = z.object({
  customer: z.object({ timeZone: z.string().nullish() }),
  campaign: z.object({
    id: z.coerce.string().min(1),
    name: z.string(),
    status: z.string(),
    servingStatus: z.string().nullish(),
    advertisingChannelType: z.string().nullish(),
    biddingStrategyType: z.string().nullish(),
    startDateTime: z.string().nullish(),
    endDateTime: z.string().nullish(),
  }),
  campaignBudget: z
    .object({ amountMicros: z.coerce.number().nullish() })
    .nullish(),
});

const criterionRowSchema = z.object({
  campaignCriterion: z.object({
    type: z.string(),
    location: z.object({ geoTargetConstant: z.string() }).nullish(),
    language: z.object({ languageConstant: z.string() }).nullish(),
  }),
  languageConstant: z
    .object({ id: z.coerce.string().min(1), name: z.string() })
    .nullish(),
});

const geoRowSchema = z.object({
  geoTargetConstant: z.object({
    id: z.coerce.string().min(1),
    name: z.string(),
    canonicalName: z.string(),
    targetType: z.string().nullish(),
    countryCode: z.string().nullish(),
  }),
});

const adGroupRowSchema = z.object({
  adGroup: z.object({ id: z.coerce.string() }),
});

const keywordRowSchema = z.object({
  adGroupCriterion: z.object({
    criterionId: z.coerce.string().min(1),
    keyword: z.object({
      text: z.string(),
      // Kept as text: a match type we do not know is skipped, not a failure.
      matchType: z.string(),
    }),
    status: z.string(),
    approvalStatus: z.string().nullish(),
  }),
});

const adRowSchema = z.object({
  adGroupAd: z.object({
    status: z.string(),
    adStrength: z.string().nullish(),
    policySummary: z
      .object({
        approvalStatus: z.string().nullish(),
        reviewStatus: z.string().nullish(),
      })
      .nullish(),
    ad: z.object({
      id: z.coerce.string().min(1),
      type: z.string(),
      finalUrls: z.array(z.string()).nullish(),
      responsiveSearchAd: z
        .object({
          headlines: textAssetsSchema,
          descriptions: textAssetsSchema,
          path1: z.string().nullish(),
          path2: z.string().nullish(),
        })
        .nullish(),
      responsiveDisplayAd: z
        .object({
          marketingImages: imageAssetsSchema,
          squareMarketingImages: imageAssetsSchema,
          squareLogoImages: imageAssetsSchema,
          headlines: textAssetsSchema,
          longHeadline: z.object({ text: z.string() }).nullish(),
          descriptions: textAssetsSchema,
          businessName: z.string().nullish(),
        })
        .nullish(),
    }),
  }),
});

const imageAssetRowSchema = z.object({
  asset: z.object({
    resourceName: z.string(),
    id: z.coerce.string().min(1),
    imageAsset: z.object({
      fullSize: z.object({
        url: z.string(),
        widthPixels: z.coerce.number(),
        heightPixels: z.coerce.number(),
      }),
    }),
  }),
});

const linkedAssetRowSchema = z.object({
  campaignAsset: z.object({ fieldType: z.string() }),
  asset: z.object({
    id: z.coerce.string().min(1),
    finalUrls: z.array(z.string()).nullish(),
    sitelinkAsset: z
      .object({
        linkText: z.string(),
        description1: z.string().nullish(),
        description2: z.string().nullish(),
      })
      .nullish(),
    calloutAsset: z.object({ calloutText: z.string() }).nullish(),
    policySummary: z.object({ approvalStatus: z.string().nullish() }).nullish(),
  }),
});

const dailyRowSchema = z.object({
  segments: z.object({ date: z.string() }),
  metrics: metricRowSchema.shape.metrics,
});

/** The id after the last slash of a resource name. */
function resourceId(resourceName: string): string {
  return resourceName.slice(resourceName.lastIndexOf("/") + 1);
}

/** Today's date (`YYYY-MM-DD`) in the time zone; UTC without one. */
function todayIn(timeZone: string | null | undefined, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The `days` dates before `today`, oldest first. */
function daysBefore(today: string, days: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    new Date(end - (days - i) * MS_PER_DAY).toISOString().slice(0, 10),
  );
}

const AD_TYPES = {
  SEARCH: "RESPONSIVE_SEARCH_AD",
  DISPLAY: "RESPONSIVE_DISPLAY_AD",
} as const;

type AdRow = z.infer<typeof adRowSchema>["adGroupAd"];

function buildCampaignAd(
  { status, adStrength, policySummary, ad }: AdRow,
  imageAssets: ReadonlyMap<
    string,
    z.infer<typeof imageAssetRowSchema>["asset"]
  >,
): GoogleCampaignAd {
  const { responsiveSearchAd: search, responsiveDisplayAd: display } = ad;
  const roles: [GoogleDisplayImageRole, string[]][] = display
    ? [
        ["LANDSCAPE", display.marketingImages],
        ["SQUARE", display.squareMarketingImages],
        ["LOGO", display.squareLogoImages],
      ]
    : [];
  return {
    id: ad.id,
    status,
    approvalStatus: policySummary?.approvalStatus ?? null,
    reviewStatus: policySummary?.reviewStatus ?? null,
    adStrength: adStrength ?? null,
    finalUrl: ad.finalUrls?.[0] ?? "",
    ...(ad.type === AD_TYPES.SEARCH &&
      search && {
        search: {
          headlines: search.headlines,
          descriptions: search.descriptions,
          path1: search.path1 ?? null,
          path2: search.path2 ?? null,
        },
      }),
    ...(ad.type === AD_TYPES.DISPLAY &&
      display && {
        display: {
          businessName: display.businessName ?? "",
          headlines: display.headlines,
          longHeadline: display.longHeadline?.text ?? "",
          descriptions: display.descriptions,
          images: roles.flatMap(([role, names]) =>
            names.flatMap((name) => {
              const asset = imageAssets.get(name);
              if (!asset) return [];
              const { url, widthPixels, heightPixels } =
                asset.imageAsset.fullSize;
              return [
                {
                  assetId: asset.id,
                  role,
                  url,
                  width: widthPixels,
                  height: heightPixels,
                },
              ];
            }),
          ),
        },
      }),
  };
}

/** Why a campaign cannot be edited in place; the first failing rule wins. */
function notEditableReason(
  type: GoogleCampaignType,
  adGroupCount: number,
  ads: readonly AdRow[],
): GoogleCampaignNotEditableReason | null {
  if (type === "OTHER") return "TYPE";
  if (adGroupCount !== 1) return "AD_GROUPS";
  return ads.length === 1 && ads[0]?.ad.type === AD_TYPES[type]
    ? null
    : "AD_TYPE";
}

/**
 * One non-removed Google campaign with its targeting, keywords, ad, sitelinks,
 * callouts and daily performance over the range. All of it is read with GAQL
 * in one session: the independent queries run together, then the location and
 * image lookups that need their results. 404 when the campaign is not in the
 * customer or is removed.
 */
export async function getGoogleCampaignDetails(
  input: AdsConnectedAccount & {
    customerId: string;
    campaignId: string;
    /** ISO 4217 code of the customer. */
    currency: string;
    range: AdRange;
  },
): Promise<GoogleCampaignDetails> {
  const { customerId, campaignId, currency, range, ...connected } = input;
  // The id goes into the queries, so it must be digits only.
  if (!/^\d{1,20}$/.test(campaignId)) throw notFound("Campaign not found");
  const campaignQuery = `campaign.id = ${campaignId}`;

  const {
    head,
    criteria,
    adGroups,
    keywords,
    ads,
    linkedAssets,
    dailyRows,
    geoTargets,
    imageAssets,
  } = await withAdsToolSession(
    {
      ...connected,
      toolkit: PROJECT_AD_PROVIDERS.google_ads,
      toolSlugs: [SEARCH_STREAM_GAQL],
    },
    async (execute) => {
      const search = async <T extends z.ZodType>(
        query: string,
        schema: T,
        what: string,
      ): Promise<z.infer<T>[]> => {
        const context = `read Google Ads campaign ${what}`;
        return parseToolRows(
          requireToolRows(
            await execute(SEARCH_STREAM_GAQL, {
              customer_id: customerId,
              query,
            }),
            "results",
            context,
          ),
          schema,
          context,
        );
      };
      const [
        [head],
        criteria,
        adGroups,
        keywords,
        ads,
        linkedAssets,
        dailyRows,
      ] = await Promise.all([
        search(
          `SELECT customer.time_zone, campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.start_date_time, campaign.end_date_time, campaign_budget.amount_micros FROM campaign WHERE ${campaignQuery} AND campaign.status != 'REMOVED'`,
          detailCampaignRowSchema,
          "details",
        ),
        search(
          `SELECT campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant, language_constant.id, language_constant.name FROM campaign_criterion WHERE ${campaignQuery} AND campaign_criterion.negative = FALSE AND campaign_criterion.status != 'REMOVED' AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE')`,
          criterionRowSchema,
          "targeting",
        ),
        search(
          `SELECT ad_group.id, ad_group.status FROM ad_group WHERE ${campaignQuery} AND ad_group.status != 'REMOVED'`,
          adGroupRowSchema,
          "ad groups",
        ),
        search(
          `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.approval_status FROM ad_group_criterion WHERE ${campaignQuery} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED' AND ad_group.status != 'REMOVED'`,
          keywordRowSchema,
          "keywords",
        ),
        search(
          `SELECT ad_group_ad.status, ad_group_ad.ad_strength, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2, ad_group_ad.ad.responsive_display_ad.marketing_images, ad_group_ad.ad.responsive_display_ad.square_marketing_images, ad_group_ad.ad.responsive_display_ad.square_logo_images, ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.long_headline, ad_group_ad.ad.responsive_display_ad.descriptions, ad_group_ad.ad.responsive_display_ad.business_name, ad_group.id FROM ad_group_ad WHERE ${campaignQuery} AND ad_group_ad.status != 'REMOVED' AND ad_group.status != 'REMOVED'`,
          adRowSchema,
          "ads",
        ),
        search(
          `SELECT campaign_asset.field_type, campaign_asset.status, asset.id, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.final_urls, asset.callout_asset.callout_text, asset.policy_summary.approval_status FROM campaign_asset WHERE campaign_asset.campaign = 'customers/${customerId}/campaigns/${campaignId}' AND campaign_asset.field_type IN ('SITELINK', 'CALLOUT') AND campaign_asset.status = 'ENABLED'`,
          linkedAssetRowSchema,
          "assets",
        ),
        search(
          `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${campaignQuery} AND segments.date DURING ${range}`,
          dailyRowSchema,
          "metrics",
        ),
      ]);
      if (!head) throw notFound("Campaign not found");

      // Resource names come from Google's own rows, not from the request.
      const locationNames = criteria.flatMap(({ campaignCriterion }) =>
        campaignCriterion.type === "LOCATION" && campaignCriterion.location
          ? [campaignCriterion.location.geoTargetConstant]
          : [],
      );
      const imageNames = [
        ...new Set(
          ads.flatMap(({ adGroupAd }) => {
            const display = adGroupAd.ad.responsiveDisplayAd;
            return display
              ? [
                  ...display.marketingImages,
                  ...display.squareMarketingImages,
                  ...display.squareLogoImages,
                ]
              : [];
          }),
        ),
      ];
      const inList = (names: readonly string[]) =>
        names.map((name) => `'${name}'`).join(", ");
      const [geoTargets, imageAssets] = await Promise.all([
        locationNames.length > 0
          ? search(
              `SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.target_type, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${inList(locationNames)})`,
              geoRowSchema,
              "locations",
            )
          : [],
        imageNames.length > 0
          ? search(
              `SELECT asset.resource_name, asset.id, asset.image_asset.full_size.url, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels FROM asset WHERE asset.resource_name IN (${inList(imageNames)})`,
              imageAssetRowSchema,
              "images",
            )
          : [],
      ]);
      return {
        head,
        criteria,
        adGroups,
        keywords,
        ads,
        linkedAssets,
        dailyRows,
        geoTargets,
        imageAssets,
      };
    },
  );

  const { campaign } = head;
  const type: GoogleCampaignType =
    campaign.advertisingChannelType === "SEARCH" ||
    campaign.advertisingChannelType === "DISPLAY"
      ? campaign.advertisingChannelType
      : "OTHER";
  const startDate = campaign.startDateTime?.slice(0, 10) || null;
  const endDate = campaign.endDateTime?.slice(0, 10) || null;
  const today = todayIn(head.customer.timeZone, new Date());
  const adRows = ads.map(({ adGroupAd }) => adGroupAd);
  const reason = notEditableReason(type, adGroups.length, adRows);

  // Geo constants keep the order of the criteria that named them.
  const geoById = new Map(
    geoTargets.map(({ geoTargetConstant }) => [
      geoTargetConstant.id,
      geoTargetConstant,
    ]),
  );
  const locations = criteria.flatMap(({ campaignCriterion }) => {
    const constant = geoById.get(
      resourceId(campaignCriterion.location?.geoTargetConstant ?? ""),
    );
    return constant
      ? [
          {
            id: constant.id,
            name: constant.name,
            canonicalName: constant.canonicalName,
            targetType: constant.targetType ?? "",
            countryCode: constant.countryCode ?? "",
          },
        ]
      : [];
  });
  const languages = criteria.flatMap(
    ({ campaignCriterion, languageConstant }) =>
      campaignCriterion.type === "LANGUAGE" && languageConstant
        ? [{ id: languageConstant.id, name: languageConstant.name }]
        : [],
  );

  const imageAssetsByName = new Map(
    imageAssets.map(({ asset }) => [asset.resourceName, asset]),
  );
  const [onlyAd] = adRows;

  const empty = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
  const perDay = new Map<string, typeof empty>();
  for (const { segments, metrics } of dailyRows) {
    const day = perDay.get(segments.date) ?? empty;
    perDay.set(segments.date, {
      spend: day.spend + (metrics.costMicros ?? 0) / MICROS,
      impressions: day.impressions + (metrics.impressions ?? 0),
      clicks: day.clicks + (metrics.clicks ?? 0),
      conversions: day.conversions + (metrics.conversions ?? 0),
    });
  }
  const days = daysBefore(today, range === "LAST_7_DAYS" ? 7 : 30).map(
    (date) => ({ date, ...(perDay.get(date) ?? empty) }),
  );

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: googleStatus(campaign.status, campaign.servingStatus),
      type,
      channelType: campaign.advertisingChannelType ?? "",
      dailyBudget: round((head.campaignBudget?.amountMicros ?? 0) / MICROS, 2),
      currency,
      biddingStrategyType: campaign.biddingStrategyType ?? "",
      startDate,
      endDate: endDate === NO_END_DATE ? null : endDate,
      started: startDate !== null && startDate <= today,
      editable: reason === null,
      notEditableReason: reason,
    },
    targeting: { locations, languages },
    keywords: keywords.flatMap(
      ({
        adGroupCriterion: { criterionId, keyword, status, approvalStatus },
      }) => {
        const matchType = GOOGLE_KEYWORD_MATCH_TYPES.find(
          (known) => known === keyword.matchType,
        );
        return matchType
          ? [
              {
                id: criterionId,
                text: keyword.text,
                matchType,
                status,
                approvalStatus: approvalStatus ?? null,
              },
            ]
          : [];
      },
    ),
    ad:
      adRows.length === 1 && onlyAd
        ? buildCampaignAd(onlyAd, imageAssetsByName)
        : null,
    sitelinks: linkedAssets.flatMap(({ campaignAsset, asset }) =>
      campaignAsset.fieldType === "SITELINK" && asset.sitelinkAsset
        ? [
            {
              assetId: asset.id,
              text: asset.sitelinkAsset.linkText,
              finalUrl: asset.finalUrls?.[0] ?? "",
              description1: asset.sitelinkAsset.description1 ?? null,
              description2: asset.sitelinkAsset.description2 ?? null,
              approvalStatus: asset.policySummary?.approvalStatus ?? null,
            },
          ]
        : [],
    ),
    callouts: linkedAssets.flatMap(({ campaignAsset, asset }) =>
      campaignAsset.fieldType === "CALLOUT" && asset.calloutAsset
        ? [
            {
              assetId: asset.id,
              text: asset.calloutAsset.calloutText,
              approvalStatus: asset.policySummary?.approvalStatus ?? null,
            },
          ]
        : [],
    ),
    performance: {
      totals: summarizeAdMetrics(
        days.reduce(
          (total, day) => ({
            spend: total.spend + day.spend,
            impressions: total.impressions + day.impressions,
            clicks: total.clicks + day.clicks,
            conversions: total.conversions + day.conversions,
          }),
          empty,
        ),
      ),
      daily: days.map(({ date, spend, impressions, clicks, conversions }) => ({
        date,
        spend: round(spend, 2),
        impressions,
        clicks,
        conversions: round(conversions, 2),
      })),
    },
  };
}
