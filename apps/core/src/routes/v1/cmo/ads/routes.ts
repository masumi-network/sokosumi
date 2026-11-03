import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { AD_RANGES } from "@/lib/ads/campaigns";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
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
} from "@/services/cmo-cuso.service";

import { mapAdsServiceError } from "../../projects/[id]/ads/route-helpers";
import { requireOverview, rethrow } from "../helpers";

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

const connectRoute = createRoute({
  method: "post",
  path: "/ads/{provider}/connect",
  operationId: "connectCmoAds",
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
});

const finalizeRoute = createRoute({
  method: "post",
  path: "/ads/finalize",
  operationId: "finalizeCmoAds",
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
});

const choicesRoute = createRoute({
  method: "get",
  path: "/ads/connections/{adConnectionId}/choices",
  operationId: "listCmoAdChoices",
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
});

const chooseRoute = createRoute({
  method: "post",
  path: "/ads/accounts",
  operationId: "chooseCmoAdAccount",
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
});

const campaignsRoute = createRoute({
  method: "get",
  path: "/ads/campaigns",
  operationId: "listCmoAdCampaigns",
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
});

const launchRoute = createRoute({
  method: "post",
  path: "/ads/launch",
  operationId: "launchCmoSearchAd",
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
});

const statusRoute = createRoute({
  method: "post",
  path: "/ads/campaigns/status",
  operationId: "setCmoAdCampaignStatus",
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
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(connectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { provider } = c.req.valid("param");
    const { returnUrl } = c.req.valid("json");
    return ok(
      c,
      await connectCmoAds({ userId, provider, returnUrl }).catch(rethrowAds),
    );
  });

  app.openapi(finalizeRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    return ok(c, await finalizeCmoAds({ userId, ...body }).catch(rethrowAds));
  });

  app.openapi(choicesRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { adConnectionId } = c.req.valid("param");
    const accounts = await listCmoAdChoices({ userId, adConnectionId }).catch(
      rethrowAds,
    );
    return ok(c, { accounts });
  });

  app.openapi(chooseRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await chooseCmoAdAccount({ userId, ...c.req.valid("json") }).catch(
      rethrowAds,
    );
    return ok(c, await requireOverview(userId));
  });

  app.openapi(campaignsRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { range } = c.req.valid("query");
    const accounts = await listCmoAdCampaigns({ userId, range }).catch(
      rethrowAds,
    );
    return ok(c, { accounts });
  });

  app.openapi(launchRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { entryId } = c.req.valid("json");
    await launchCmoSearchAd({ userId, entryId }).catch(rethrowAds);
    return ok(c, await requireOverview(userId));
  });

  app.openapi(statusRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await setCmoAdCampaignStatus({ userId, ...c.req.valid("json") }).catch(
      rethrowAds,
    );
    return ok(c, await requireOverview(userId));
  });
}
