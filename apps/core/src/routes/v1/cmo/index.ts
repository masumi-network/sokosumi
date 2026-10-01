import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoBrandBrainRequestSchema,
  cmoOnboardingRequestSchema,
  cmoOverviewSchema,
  cmoStrategyRequestSchema,
  cmoStrategySettingsRequestSchema,
  cmoTurnStartedSchema,
} from "@/schemas/cmo.schema";
import {
  CmoConflictError,
  CmoNotFoundError,
  type CmoOverview,
  getCmoOverview,
  requestCmoStrategy,
  saveCmoBrandBrain,
  startCmoOnboarding,
  updateCmoStrategySettings,
} from "@/services/cmo.service";

/**
 * CMO.xyz's API. The CMO app calls it server side with the person's Sign in
 * with Sokosumi token; everything is scoped to the caller's own CMO
 * workspace, so no organization header is needed.
 */
const app = new OpenAPIHonoWithAuth();

function mapOverview(overview: CmoOverview) {
  const { workspace } = overview;
  return cmoOverviewSchema.parse({
    id: workspace.id,
    businessName: workspace.businessName,
    websiteUrl: workspace.websiteUrl,
    goals: workspace.goals,
    organizationId: workspace.organizationId,
    organizationSlug: overview.organizationSlug,
    workspaceId: workspace.workspaceId,
    sokoBotId: workspace.sokoBotId,
    projectId: workspace.projectId,
    roomId: overview.roomId,
    botStatus: overview.botStatus,
    subscriptionActive: overview.subscriptionActive,
    brandBrain: overview.brandBrain,
    brandBrainUpdatedAt: workspace.brandBrainUpdatedAt,
    strategy: overview.strategy,
    strategyUpdatedAt: workspace.strategyUpdatedAt,
    createdAt: workspace.createdAt,
  });
}

async function requireOverview(userId: string) {
  const overview = await getCmoOverview(userId);
  if (!overview) throw notFound("No CMO workspace yet");
  return mapOverview(overview);
}

function rethrow(error: unknown): never {
  if (error instanceof CmoNotFoundError) throw notFound(error.message);
  if (error instanceof CmoConflictError) throw conflict(error.message);
  throw error;
}

app.openapi(
  createRoute({
    method: "get",
    path: "/",
    operationId: "getCmoOverview",
    tags: ["CMO"],
    responses: {
      200: jsonSuccessResponse(cmoOverviewSchema, "The caller's CMO workspace"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("No CMO workspace yet"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, await requireOverview(userId));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/onboarding",
    operationId: "startCmoOnboarding",
    tags: ["CMO"],
    request: {
      body: {
        content: { "application/json": { schema: cmoOnboardingRequestSchema } },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        cmoOverviewSchema,
        "CMO workspace created; Cuso is learning the business",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonErrorResponse("Conflict"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    await startCmoOnboarding({ userId, ...body }).catch(rethrow);
    return created(c, await requireOverview(userId));
  },
);

app.openapi(
  createRoute({
    method: "put",
    path: "/brand-brain",
    operationId: "updateCmoBrandBrain",
    tags: ["CMO"],
    request: {
      body: {
        content: { "application/json": { schema: cmoBrandBrainRequestSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(cmoOverviewSchema, "Brand Brain saved"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("No CMO workspace yet"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { brandBrain } = c.req.valid("json");
    await saveCmoBrandBrain({ userId }, brandBrain).catch(rethrow);
    return ok(c, await requireOverview(userId));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/strategy",
    operationId: "requestCmoStrategy",
    tags: ["CMO"],
    request: {
      body: {
        content: { "application/json": { schema: cmoStrategyRequestSchema } },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        cmoTurnStartedSchema,
        "Cuso started planning the month",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("No CMO workspace yet"),
      409: jsonErrorResponse("The Brand Brain is not ready yet"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { note } = c.req.valid("json");
    const started = await requestCmoStrategy({ userId, note }).catch(rethrow);
    return created(c, cmoTurnStartedSchema.parse(started));
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/strategy/settings",
    operationId: "updateCmoStrategySettings",
    tags: ["CMO"],
    request: {
      body: {
        content: {
          "application/json": { schema: cmoStrategySettingsRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(cmoOverviewSchema, "Settings saved"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("No CMO workspace yet"),
      409: jsonErrorResponse("There is no strategy yet"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    await updateCmoStrategySettings({ userId, ...body }).catch(rethrow);
    return ok(c, await requireOverview(userId));
  },
);

export default app;
