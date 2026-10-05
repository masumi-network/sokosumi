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
  cmoTurnStartedSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";
import {
  approveCmoStrategy,
  CmoConflictError,
  CmoNotFoundError,
  type CmoOverview,
  getCmoOverview,
  pauseCmoCalendarEntry,
  requestCmoStrategy,
  retryCmoOnboarding,
  revertCmoUpdate,
  saveCmoBrandBrain,
  startCmoOnboarding,
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
    learning: overview.learning,
    routines: overview.routines,
    subscriptionActive: overview.subscriptionActive,
    brandBrain: overview.brandBrain,
    brandBrainUpdatedAt: workspace.brandBrainUpdatedAt,
    strategy: overview.strategy,
    strategyUpdatedAt: workspace.strategyUpdatedAt,
    strategyApprovedAt: workspace.strategyApprovedAt,
    updates: overview.updates.map(
      ({ previousStrategy, revertedAt, ...update }) => ({
        ...update,
        revertible: previousStrategy !== undefined && !revertedAt,
        revertedAt: revertedAt ?? null,
      }),
    ),
    channels: overview.channels.map((channel) => ({
      id: channel.id,
      provider: channel.provider,
      handle: channel.externalHandle,
      displayName: channel.displayName,
      status: channel.status,
    })),
    upNext: overview.upNext,
    connectChannelUrl: overview.connectChannelUrl,
    subscribeUrl: overview.subscribeUrl,
    billing: overview.billing,
    posts: {
      draft: overview.posts.DRAFT ?? 0,
      scheduled:
        (overview.posts.SCHEDULED ?? 0) + (overview.posts.PUBLISHING ?? 0),
      published: overview.posts.PUBLISHED ?? 0,
      failed: (overview.posts.FAILED ?? 0) + (overview.posts.MISSED ?? 0),
    },
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
    method: "post",
    path: "/onboarding/retry",
    operationId: "retryCmoOnboarding",
    tags: ["CMO"],
    description:
      "Starts Cuso's first look at the business again after it failed or got stuck.",
    responses: {
      201: jsonSuccessResponse(cmoTurnStartedSchema, "Cuso is learning again"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("No CMO workspace yet"),
      409: jsonErrorResponse("Cuso is still learning or already done"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const started = await retryCmoOnboarding(userId).catch(rethrow);
    return created(c, cmoTurnStartedSchema.parse(started));
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
    method: "post",
    path: "/strategy/approve",
    operationId: "approveCmoStrategy",
    tags: ["CMO"],
    description:
      "The owner's one approval: from now on Cuso executes the strategy on its own (with an active CMO subscription).",
    responses: {
      200: jsonSuccessResponse(cmoOverviewSchema, "Strategy approved"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("No CMO workspace yet"),
      409: jsonErrorResponse("There is no strategy to approve yet"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await approveCmoStrategy(userId).catch(rethrow);
    return ok(c, await requireOverview(userId));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/updates/{id}/revert",
    operationId: "revertCmoUpdate",
    tags: ["CMO"],
    description: "Puts back the strategy a weekly review changed.",
    request: { params: cmoUpdateIdParamsSchema },
    responses: {
      200: jsonSuccessResponse(cmoOverviewSchema, "Strategy reverted"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Nothing to revert"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await revertCmoUpdate({ userId, updateId: id }).catch(rethrow);
    return ok(c, await requireOverview(userId));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/calendar/{id}/pause",
    operationId: "pauseCmoCalendarEntry",
    tags: ["CMO"],
    description:
      "Pauses one calendar entry: cancels its scheduled post and takes it out of the plan.",
    request: { params: cmoUpdateIdParamsSchema },
    responses: {
      200: jsonSuccessResponse(cmoOverviewSchema, "Entry paused"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("No such calendar entry"),
      409: jsonErrorResponse("The post can no longer be canceled"),
    },
  }),
  async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await pauseCmoCalendarEntry({ userId, entryId: id }).catch(rethrow);
    return ok(c, await requireOverview(userId));
  },
);

export default app;
