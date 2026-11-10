import { z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { AD_RANGES, type AdRange } from "@/lib/ads/campaigns";
import { requireOverview, rethrow } from "@/routes/v1/cmo/helpers";
import { mapAdsServiceError } from "@/routes/v1/projects/[id]/ads/route-helpers";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import {
  adCampaignSchema,
  availableAdAccountSchema,
} from "@/schemas/project-ad-account.schema";
import {
  chooseCmoAdAccount,
  connectCmoAds,
  finalizeCmoAds,
  launchCmoSearchAd,
  listCmoAdCampaigns,
  listCmoAdChoices,
  setCmoAdCampaignStatus,
} from "@/services/cmo-ads.service";
import {
  CmoConflictError,
  CmoForbiddenError,
  CmoNotFoundError,
  type CusoTarget,
} from "@/services/cmo-cuso.service";

/** CMO's refusals as CMO's routes answer them; provider failures as Ads does. */
function rethrowAds(error: unknown): never {
  if (
    error instanceof CmoNotFoundError ||
    error instanceof CmoConflictError ||
    error instanceof CmoForbiddenError
  ) {
    rethrow(error);
  }
  mapAdsServiceError(error);
}

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Not an owner or admin"),
  404: jsonErrorResponse("Cuso is not hired, or the ad is unknown"),
  409: jsonErrorResponse("Refused: over the plan's ad budget, or not ready"),
  502: jsonErrorResponse("The ads provider failed"),
  503: jsonErrorResponse("Ads are not set up here"),
};

export const connectConfig = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "Starts connecting the owner's Google Ads or Meta Ads account to Cuso's Project; the owner comes back to returnUrl on CMO.xyz.",
  request: {
    params: z.object({ provider: z.enum(["google_ads", "meta_ads"]) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ returnUrl: z.string().url() }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ redirectUrl: z.string() }).openapi("CmoAdsConnect"),
      "Sign-in started",
    ),
    ...errors,
  },
};

export const finalizeConfig = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "Finishes an ad connection once the owner is back: attaches its only ad account, or asks the owner to choose one.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            connectionId: z.string().min(1),
            sessionUri: z.union([z.string().min(1), z.null()]),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z
        .object({
          state: z.enum(["connected", "none", "choose"]),
          adConnectionId: z.string().optional(),
          accounts: z.array(availableAdAccountSchema).optional(),
        })
        .openapi("CmoAdsFinalized"),
      "Connection finished",
    ),
    ...errors,
  },
};

export const choicesConfig = {
  method: "get" as const,
  tags: ["CMO"],
  description: "The ad accounts a connection reaches, for the owner to pick.",
  request: { params: z.object({ adConnectionId: z.string().uuid() }) },
  responses: {
    200: jsonSuccessResponse(
      z.object({ accounts: z.array(availableAdAccountSchema) }),
      "Ad accounts",
    ),
    ...errors,
  },
};

export const chooseConfig = {
  method: "post" as const,
  tags: ["CMO"],
  description: "Attaches the ad account the owner picked to Cuso's Project.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            adConnectionId: z.string().uuid(),
            externalAccountId: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Attached"),
    ...errors,
  },
};

export const campaignsConfig = {
  method: "get" as const,
  tags: ["CMO"],
  description:
    "Every ad account on Cuso's Project with its campaigns and their numbers over the range.",
  request: {
    query: z.object({ range: z.enum(AD_RANGES).default("LAST_7_DAYS") }),
  },
  responses: {
    200: jsonSuccessResponse(
      z
        .object({
          accounts: z.array(
            z.object({
              account: z.object({
                id: z.string(),
                name: z.string(),
                provider: z.string(),
                currency: z.string(),
              }),
              campaigns: z.array(adCampaignSchema),
              failed: z.boolean(),
            }),
          ),
        })
        .openapi("CmoAdCampaigns"),
      "Campaigns",
    ),
    ...errors,
  },
};

export const launchConfig = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "Launches a search ad Cuso wrote: builds the Google Ads campaign from it with a share of the plan's daily ad budget, then starts it. Refused past the plan's ad budget.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ entryId: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Launched"),
    ...errors,
  },
};

export const statusConfig = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "Pauses or starts a campaign in Cuso's Project's ad account. Starting is refused past the plan's ad budget.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            accountId: z.string().uuid(),
            campaignId: z.string().min(1),
            status: z.enum(["ACTIVE", "PAUSED"]),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Changed"),
    ...errors,
  },
};

/** Each ad route acts on the Cuso a CMO call names. */
export const adsActions = {
  connect: (
    target: CusoTarget,
    provider: "google_ads" | "meta_ads",
    returnUrl: string,
  ) => connectCmoAds({ ...target, provider, returnUrl }).catch(rethrowAds),
  finalize: (
    target: CusoTarget,
    body: { connectionId: string; sessionUri: string | null },
  ) => finalizeCmoAds({ ...target, ...body }).catch(rethrowAds),
  choices: async (target: CusoTarget, adConnectionId: string) => ({
    accounts: await listCmoAdChoices({ ...target, adConnectionId }).catch(
      rethrowAds,
    ),
  }),
  choose: async (
    target: CusoTarget,
    body: { adConnectionId: string; externalAccountId: string },
  ) => {
    await chooseCmoAdAccount({ ...target, ...body }).catch(rethrowAds);
    return requireOverview(target);
  },
  campaigns: async (target: CusoTarget, range: AdRange) => ({
    accounts: await listCmoAdCampaigns({ ...target, range }).catch(rethrowAds),
  }),
  launch: async (target: CusoTarget, entryId: string) => {
    await launchCmoSearchAd({ ...target, entryId }).catch(rethrowAds);
    return requireOverview(target);
  },
  status: async (
    target: CusoTarget,
    body: {
      accountId: string;
      campaignId: string;
      status: "ACTIVE" | "PAUSED";
    },
  ) => {
    await setCmoAdCampaignStatus({ ...target, ...body }).catch(rethrowAds);
    return requireOverview(target);
  },
};
