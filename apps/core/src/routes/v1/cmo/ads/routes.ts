import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { AD_RANGES, type AdRange } from "@/lib/ads/campaigns";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOverviewSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";
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

const connectConfig = {
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

const connectRoute = createRoute({
  ...connectConfig,
  path: "/ads/{provider}/connect",
  operationId: "connectCmoAds",
});

const connectProjectRoute = createRoute({
  ...connectConfig,
  path: "/projects/{projectId}/ads/{provider}/connect",
  operationId: "connectCmoAdsForProject",
  request: {
    ...connectConfig.request,
    params: cmoProjectParamsSchema.extend({
      provider: z.enum(["google_ads", "meta_ads"]),
    }),
  },
});

const finalizeConfig = {
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

const finalizeRoute = createRoute({
  ...finalizeConfig,
  path: "/ads/finalize",
  operationId: "finalizeCmoAds",
});

const finalizeProjectRoute = createRoute({
  ...finalizeConfig,
  path: "/projects/{projectId}/ads/finalize",
  operationId: "finalizeCmoAdsForProject",
  request: { ...finalizeConfig.request, params: cmoProjectParamsSchema },
});

const choicesConfig = {
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

const choicesRoute = createRoute({
  ...choicesConfig,
  path: "/ads/connections/{adConnectionId}/choices",
  operationId: "listCmoAdChoices",
});

const choicesProjectRoute = createRoute({
  ...choicesConfig,
  path: "/projects/{projectId}/ads/connections/{adConnectionId}/choices",
  operationId: "listCmoAdChoicesForProject",
  request: {
    ...choicesConfig.request,
    params: cmoProjectParamsSchema.extend({
      adConnectionId: z.string().uuid(),
    }),
  },
});

const chooseConfig = {
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

const chooseRoute = createRoute({
  ...chooseConfig,
  path: "/ads/accounts",
  operationId: "chooseCmoAdAccount",
});

const chooseProjectRoute = createRoute({
  ...chooseConfig,
  path: "/projects/{projectId}/ads/accounts",
  operationId: "chooseCmoAdAccountForProject",
  request: { ...chooseConfig.request, params: cmoProjectParamsSchema },
});

const campaignsConfig = {
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

const campaignsRoute = createRoute({
  ...campaignsConfig,
  path: "/ads/campaigns",
  operationId: "listCmoAdCampaigns",
});

const campaignsProjectRoute = createRoute({
  ...campaignsConfig,
  path: "/projects/{projectId}/ads/campaigns",
  operationId: "listCmoAdCampaignsForProject",
  request: { ...campaignsConfig.request, params: cmoProjectParamsSchema },
});

const launchConfig = {
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

const launchRoute = createRoute({
  ...launchConfig,
  path: "/ads/launch",
  operationId: "launchCmoSearchAd",
});

const launchProjectRoute = createRoute({
  ...launchConfig,
  path: "/projects/{projectId}/ads/launch",
  operationId: "launchCmoSearchAdForProject",
  request: { ...launchConfig.request, params: cmoProjectParamsSchema },
});

const statusConfig = {
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

const statusRoute = createRoute({
  ...statusConfig,
  path: "/ads/campaigns/status",
  operationId: "setCmoAdCampaignStatus",
});

const statusProjectRoute = createRoute({
  ...statusConfig,
  path: "/projects/{projectId}/ads/campaigns/status",
  operationId: "setCmoAdCampaignStatusForProject",
  request: { ...statusConfig.request, params: cmoProjectParamsSchema },
});

/** Each ad route acts on the Cuso a CMO call names. */
const adsActions = {
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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(connectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { provider } = c.req.valid("param");
    const { returnUrl } = c.req.valid("json");
    return ok(c, await adsActions.connect({ userId }, provider, returnUrl));
  });
  app.openapi(connectProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, provider } = c.req.valid("param");
    const { returnUrl } = c.req.valid("json");
    return ok(
      c,
      await adsActions.connect({ userId, projectId }, provider, returnUrl),
    );
  });

  app.openapi(finalizeRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, await adsActions.finalize({ userId }, c.req.valid("json")));
  });
  app.openapi(finalizeProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(
      c,
      await adsActions.finalize({ userId, projectId }, c.req.valid("json")),
    );
  });

  app.openapi(choicesRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { adConnectionId } = c.req.valid("param");
    return ok(c, await adsActions.choices({ userId }, adConnectionId));
  });
  app.openapi(choicesProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, adConnectionId } = c.req.valid("param");
    return ok(
      c,
      await adsActions.choices({ userId, projectId }, adConnectionId),
    );
  });

  app.openapi(chooseRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, await adsActions.choose({ userId }, c.req.valid("json")));
  });
  app.openapi(chooseProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(
      c,
      await adsActions.choose({ userId, projectId }, c.req.valid("json")),
    );
  });

  app.openapi(campaignsRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { range } = c.req.valid("query");
    return ok(c, await adsActions.campaigns({ userId }, range));
  });
  app.openapi(campaignsProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { range } = c.req.valid("query");
    return ok(c, await adsActions.campaigns({ userId, projectId }, range));
  });

  app.openapi(launchRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { entryId } = c.req.valid("json");
    return ok(c, await adsActions.launch({ userId }, entryId));
  });
  app.openapi(launchProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { entryId } = c.req.valid("json");
    return ok(c, await adsActions.launch({ userId, projectId }, entryId));
  });

  app.openapi(statusRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, await adsActions.status({ userId }, c.req.valid("json")));
  });
  app.openapi(statusProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(
      c,
      await adsActions.status({ userId, projectId }, c.req.valid("json")),
    );
  });
}
