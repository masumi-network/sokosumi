import { createRoute, z } from "@hono/zod-openapi";
import {
  composeSystemPrompt,
  getSokoBotSkill,
  SOKO_BOT_VERSIONS,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";

import { getEnv } from "@/config/env";
import {
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { created, ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  claimSokoBotAvatarRequestSchema,
  connectSokoBotIntegrationRequestSchema,
  connectSokoBotIntegrationResponseSchema,
  createSokoBotRequestSchema,
  createSokoBotScheduleRequestSchema,
  finalizeSokoBotIntegrationResponseSchema,
  installSokoBotSkillRequestSchema,
  installSokoBotSkillResponseSchema,
  introduceSokoBotRequestSchema,
  introduceSokoBotResponseSchema,
  judgeSokoBotLabTurnRequestSchema,
  listSokoBotAvatarsQuerySchema,
  listSokoBotLabRunsQuerySchema,
  resolveSokoBotDecisionRequestSchema,
  simulateSokoBotTaskEventRequestSchema,
  sokoBotAvatarSchema,
  sokoBotDailyStatsSchema,
  sokoBotInstalledSkillSchema,
  sokoBotIntegrationsSchema,
  sokoBotLabRunSchema,
  sokoBotLabTaskEventSchema,
  sokoBotLabVerdictSchema,
  sokoBotMemorySchema,
  sokoBotPendingDecisionSchema,
  sokoBotScheduleSchema,
  sokoBotSchema,
  sokoBotSkillBrowseSchema,
  sokoBotSkillSearchResultSchema,
  sokoBotStateSchema,
  sokoBotTeamSchema,
  sokoBotTurnSchema,
  sokoBotVersionSchema,
  startSokoBotTurnRequestSchema,
  startSokoBotTurnResponseSchema,
  updateSokoBotScheduleRequestSchema,
  updateSokoBotVersionRequestSchema,
} from "@/schemas/soko-bot.schema";
import {
  claimAvatar,
  listAvailableAvatars,
} from "@/services/soko-bot-avatar.service";
import { SokoBotBillingAccessError } from "@/services/soko-bot-billing.service";
import {
  ensureSokoBotCoworker,
  introduceSokoBot,
  SokoBotIntroductionError,
} from "@/services/soko-bot-chat.service";
import {
  SokoBotBusyError,
  SokoBotIdempotencyConflictError,
  SokoBotNotFoundError,
  SokoBotRetryableStartError,
  SokoBotStartAbortedError,
  SokoBotValidationError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import {
  connectSokoBotIntegration,
  disconnectSokoBotIntegration,
  finalizeSokoBotIntegration,
  listSokoBotIntegrations,
  SokoBotIntegrationError,
} from "@/services/soko-bot-integrations.service";
import {
  SokoBotLabError,
  simulateSokoBotTaskEvent,
} from "@/services/soko-bot-lab.service";
import {
  judgeSokoBotLabTurn,
  SokoBotLabJudgeError,
} from "@/services/soko-bot-lab-judge.service";
import {
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
  sokoBotRuntimeService,
} from "@/services/soko-bot-runtime.service";
import {
  browseSkillsSh,
  installSkill,
  listInstalledSkills,
  removeInstalledSkill,
  SokoBotSkillError,
  searchSkillsSh,
} from "@/services/soko-bot-skills.service";
import { getSokoBotDailyStats } from "@/services/soko-bot-stats.service";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
const sokoBotPaginationQuerySchema = cursorPaginationQuerySchema.extend({
  cursor: z.string().uuid().optional(),
});

app.use("*", async (_c, next) => {
  if (!getEnv().SOKO_BOT_ENABLED) throw notFound("Soko Bot is not enabled");
  await next();
});

function mapBot(
  bot: Awaited<ReturnType<typeof sokoBotControlPlane.getForUser>>,
) {
  if (!bot) return null;
  return {
    ...bot,
    memory: bot.memoryRevisions[0] ?? null,
    coworker: bot.coworker ?? null,
    memoryRevisions: undefined,
  };
}

type TurnWithAttribution = Awaited<
  ReturnType<typeof sokoBotControlPlane.listTurns>
>["turns"][number];

/** Flatten the mention → message → room chain into `chatRoom`. */
function mapTurn<T extends Partial<TurnWithAttribution>>(turn: T) {
  const room = turn.chatMention?.message?.room ?? null;
  return { ...turn, chatMention: undefined, chatRoom: room };
}

function mapControlPlaneError(error: unknown): never {
  if (error instanceof SokoBotBillingAccessError)
    throw forbidden(error.message);
  if (error instanceof SokoBotNotFoundError) throw notFound(error.message);
  if (error instanceof SokoBotBusyError) throw conflict(error.message);
  if (
    error instanceof SokoBotStartAbortedError ||
    error instanceof SokoBotIdempotencyConflictError ||
    error instanceof SokoBotRetryableStartError
  ) {
    throw conflict(error.message);
  }
  if (error instanceof SokoBotValidationError) {
    throw unprocessableEntity(error.message);
  }
  if (error instanceof SokoBotRuntimeConflictError)
    throw conflict(error.message);
  if (error instanceof SokoBotRuntimeAuthorizationError)
    throw forbidden(error.message);
  if (error instanceof SokoBotRuntimeValidationError) {
    throw unprocessableEntity(error.message);
  }
  throw error;
}

const getMeRoute = createRoute({
  method: "get",
  path: "/me",
  operationId: "getMySokoBot",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotStateSchema,
      "Current user's Soko Bot state",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

app.openapi(getMeRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const bot = await sokoBotControlPlane.getForUser(
    auth.userId,
    workspace.workspaceId,
  );
  return ok(c, sokoBotStateSchema.parse({ sokoBot: mapBot(bot) }));
});

const createMeRoute = createRoute({
  method: "post",
  path: "/me",
  operationId: "createMySokoBot",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: { "application/json": { schema: createSokoBotRequestSchema } },
    },
  },
  responses: {
    201: jsonSuccessResponse(sokoBotSchema, "Create or reactivate Soko Bot"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(createMeRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    await sokoBotControlPlane.create({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      ...c.req.valid("json"),
    });
    const bot = await sokoBotControlPlane.getForUser(
      auth.userId,
      workspace.workspaceId,
    );
    if (!bot) throw new SokoBotNotFoundError("Soko Bot was not created");
    return created(c, sokoBotSchema.parse(mapBot(bot)));
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const archiveMeRoute = createRoute({
  method: "delete",
  path: "/me",
  operationId: "archiveMySokoBot",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      z.object({ archived: z.literal(true) }),
      "Archive Soko Bot",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

app.openapi(archiveMeRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  await sokoBotControlPlane.archive(auth.userId, workspace.workspaceId);
  return ok(c, { archived: true as const });
});

const startTurnRoute = createRoute({
  method: "post",
  path: "/me/turns",
  operationId: "startMySokoBotTurn",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: startSokoBotTurnRequestSchema },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      startSokoBotTurnResponseSchema,
      "Soko Bot turn accepted",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(startTurnRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const result = await sokoBotControlPlane.startTurn({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      ...c.req.valid("json"),
    });
    if (
      result.reconciliationLeaseToken &&
      (result.status === "STARTING" || result.status === "RUNNING")
    ) {
      waitUntil(
        sokoBotControlPlane
          .reconcileTurn(
            result.turnId,
            undefined,
            result.reconciliationLeaseToken,
          )
          .catch((error) => {
            console.error("Soko Bot turn reconciliation failed", {
              turnId: result.turnId,
              error: error instanceof Error ? error.message : "unknown",
            });
          }),
      );
    }
    return created(c, startSokoBotTurnResponseSchema.parse(result));
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const listTurnsRoute = createRoute({
  method: "get",
  path: "/me/turns",
  operationId: "listMySokoBotTurns",
  tags: ["Soko Bots"],
  request: {
    query: sokoBotPaginationQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(sokoBotTurnSchema),
      "List Soko Bot turns",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

app.openapi(listTurnsRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const query = c.req.valid("query");
  const { cursor, take } = parseCursorPagination(query);
  const { turns, count, hasMore } = await sokoBotControlPlane.listTurns(
    auth.userId,
    workspace.workspaceId,
    { cursor, take },
  );
  return ok(
    c,
    z.array(sokoBotTurnSchema).parse(turns.map(mapTurn)),
    createPaginationMeta(turns, count, take, hasMore, cursor),
  );
});

const turnParams = z.object({
  turnId: z
    .string()
    .uuid()
    .openapi({ param: { name: "turnId", in: "path" } }),
});

const getTurnRoute = createRoute({
  method: "get",
  path: "/me/turns/{turnId}",
  operationId: "getMySokoBotTurn",
  tags: ["Soko Bots"],
  request: { params: turnParams },
  responses: {
    200: jsonSuccessResponse(sokoBotTurnSchema, "Get Soko Bot turn"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(getTurnRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    const turn = await sokoBotControlPlane.getTurn(
      auth.userId,
      c.req.valid("param").turnId,
    );
    return ok(c, sokoBotTurnSchema.parse(mapTurn(turn)));
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const cancelTurnRoute = createRoute({
  method: "post",
  path: "/me/turns/{turnId}/cancel",
  operationId: "cancelMySokoBotTurn",
  tags: ["Soko Bots"],
  request: { params: turnParams },
  responses: {
    200: jsonSuccessResponse(
      z.object({ cancellationRequested: z.literal(true) }),
      "Cancel requested",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(cancelTurnRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    await sokoBotControlPlane.cancelTurn(
      auth.userId,
      c.req.valid("param").turnId,
    );
    return ok(c, { cancellationRequested: true as const });
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const resetMemoryRoute = createRoute({
  method: "post",
  path: "/me/memory/reset",
  operationId: "resetMySokoBotMemory",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotMemorySchema, "Reset Soko Bot memory"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

app.openapi(resetMemoryRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const memory = await sokoBotControlPlane.resetMemory(
      auth.userId,
      workspace.workspaceId,
    );
    return ok(c, sokoBotMemorySchema.parse(memory));
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const createScheduleRoute = createRoute({
  method: "post",
  path: "/me/schedules",
  operationId: "createMySokoBotSchedule",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: createSokoBotScheduleRequestSchema },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(sokoBotScheduleSchema, "Create Soko Bot schedule"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(createScheduleRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const schedule = await sokoBotControlPlane.createSchedule({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      ...c.req.valid("json"),
    });
    return created(c, sokoBotScheduleSchema.parse(schedule));
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const scheduleParams = z.object({
  scheduleId: z
    .string()
    .uuid()
    .openapi({ param: { name: "scheduleId", in: "path" } }),
});

const updateScheduleRoute = createRoute({
  method: "patch",
  path: "/me/schedules/{scheduleId}",
  operationId: "updateMySokoBotSchedule",
  tags: ["Soko Bots"],
  request: {
    params: scheduleParams,
    body: {
      content: {
        "application/json": { schema: updateSokoBotScheduleRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotScheduleSchema, "Update Soko Bot schedule"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(updateScheduleRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    const schedule = await sokoBotControlPlane.updateSchedule({
      userId: auth.userId,
      scheduleId: c.req.valid("param").scheduleId,
      ...c.req.valid("json"),
    });
    return ok(c, sokoBotScheduleSchema.parse(schedule));
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const deleteScheduleRoute = createRoute({
  method: "delete",
  path: "/me/schedules/{scheduleId}",
  operationId: "deleteMySokoBotSchedule",
  tags: ["Soko Bots"],
  request: { params: scheduleParams },
  responses: {
    200: jsonSuccessResponse(
      z.object({ deleted: z.literal(true) }),
      "Delete Soko Bot schedule",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(deleteScheduleRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    await sokoBotControlPlane.deleteSchedule(
      auth.userId,
      c.req.valid("param").scheduleId,
    );
    return ok(c, { deleted: true as const });
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const decisionParams = z.object({
  decisionId: z
    .string()
    .uuid()
    .openapi({ param: { name: "decisionId", in: "path" } }),
});

const resolveDecisionRoute = createRoute({
  method: "post",
  path: "/me/decisions/{decisionId}",
  operationId: "resolveMySokoBotDecision",
  tags: ["Soko Bots"],
  request: {
    params: decisionParams,
    body: {
      content: {
        "application/json": { schema: resolveSokoBotDecisionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      sokoBotPendingDecisionSchema,
      "Resolve Soko Bot decision",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(resolveDecisionRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    const decision = await sokoBotRuntimeService.resolveDecision(
      auth.userId,
      c.req.valid("param").decisionId,
      c.req.valid("json").resolution === "ACCEPT",
    );
    return ok(c, sokoBotPendingDecisionSchema.parse(decision));
  } catch (error) {
    mapControlPlaneError(error);
  }
});

const listAvatarsRoute = createRoute({
  method: "get",
  path: "/avatars",
  operationId: "listSokoBotAvatars",
  tags: ["Soko Bots"],
  request: { query: listSokoBotAvatarsQuerySchema },
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotAvatarSchema),
      "Unclaimed mascot avatars to pick from",
    ),
    401: jsonErrorResponse("Unauthorized"),
  },
});

app.openapi(listAvatarsRoute, async (c) => {
  requireUserAuthContext(c.var.authContext);
  const { take, exclude } = c.req.valid("query");
  const excludeIds = exclude
    ? exclude
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
  const avatars = await listAvailableAvatars(take, { excludeIds });
  return ok(c, z.array(sokoBotAvatarSchema).parse(avatars));
});

const providerParamSchema = z.object({ provider: z.string().min(1) });

function mapIntegrationError(error: unknown): never {
  if (error instanceof SokoBotIntegrationError) {
    if (error.kind === "NOT_CONFIGURED" || error.kind === "NOT_FOUND")
      throw notFound(error.message);
    if (error.kind === "UNKNOWN_PROVIDER") throw notFound(error.message);
    throw unprocessableEntity(error.message);
  }
  throw error;
}

const listIntegrationsRoute = createRoute({
  method: "get",
  path: "/me/integrations",
  operationId: "listMySokoBotIntegrations",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotIntegrationsSchema,
      "Every provider with the bot's connection state",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(listIntegrationsRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const result = await listSokoBotIntegrations(
      auth.userId,
      workspace.workspaceId,
    );
    return ok(c, sokoBotIntegrationsSchema.parse(result));
  } catch (error) {
    mapIntegrationError(error);
  }
});

const connectIntegrationRoute = createRoute({
  method: "post",
  path: "/me/integrations/{provider}/connect",
  operationId: "connectMySokoBotIntegration",
  tags: ["Soko Bots"],
  request: {
    params: providerParamSchema,
    body: {
      content: {
        "application/json": { schema: connectSokoBotIntegrationRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      connectSokoBotIntegrationResponseSchema,
      "Where to send the owner to authorise the account",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(connectIntegrationRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const result = await connectSokoBotIntegration({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      provider: c.req.valid("param").provider,
      returnUrl: c.req.valid("json").returnUrl,
    });
    return ok(c, connectSokoBotIntegrationResponseSchema.parse(result));
  } catch (error) {
    mapIntegrationError(error);
  }
});

const finalizeIntegrationRoute = createRoute({
  method: "post",
  path: "/me/integrations/{provider}/finalize",
  operationId: "finalizeMySokoBotIntegration",
  tags: ["Soko Bots"],
  request: { params: providerParamSchema },
  responses: {
    200: jsonSuccessResponse(
      finalizeSokoBotIntegrationResponseSchema,
      "Connection state after the OAuth round-trip",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(finalizeIntegrationRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const status = await finalizeSokoBotIntegration({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      provider: c.req.valid("param").provider,
    });
    return ok(c, finalizeSokoBotIntegrationResponseSchema.parse({ status }));
  } catch (error) {
    mapIntegrationError(error);
  }
});

const disconnectIntegrationRoute = createRoute({
  method: "delete",
  path: "/me/integrations/{provider}",
  operationId: "disconnectMySokoBotIntegration",
  tags: ["Soko Bots"],
  request: { params: providerParamSchema },
  responses: {
    200: jsonSuccessResponse(
      z.object({ disconnected: z.literal(true) }),
      "Disconnected",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(disconnectIntegrationRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    await disconnectSokoBotIntegration({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      provider: c.req.valid("param").provider,
    });
    return ok(c, { disconnected: true as const });
  } catch (error) {
    mapIntegrationError(error);
  }
});

const introduceRoute = createRoute({
  method: "post",
  path: "/me/introduce",
  operationId: "introduceMySokoBot",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: introduceSokoBotRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      introduceSokoBotResponseSchema,
      "The bot's introduction message in its direct room",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(introduceRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const result = await introduceSokoBot({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      roomId: c.req.valid("json").roomId,
    });
    return ok(c, introduceSokoBotResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof SokoBotIntroductionError)
      throw notFound(error.message);
    throw error;
  }
});

const claimAvatarRoute = createRoute({
  method: "post",
  path: "/me/avatar",
  operationId: "claimMySokoBotAvatar",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: claimSokoBotAvatarRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with the new avatar"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(claimAvatarRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const bot = await sokoBotControlPlane.getForUser(
    auth.userId,
    workspace.workspaceId,
  );
  if (!bot) throw notFound("Create a Soko Bot first");
  await claimAvatar(bot.id, c.req.valid("json").avatarId);
  await ensureSokoBotCoworker(bot.id);
  const refreshed = await sokoBotControlPlane.getForUser(
    auth.userId,
    workspace.workspaceId,
  );
  return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
});

const listVersionsRoute = createRoute({
  method: "get",
  path: "/versions",
  operationId: "listSokoBotVersions",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(z.array(sokoBotVersionSchema), "Agent versions"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

app.openapi(listVersionsRoute, async (c) => {
  requireUserAuthContext(c.var.authContext);
  return ok(
    c,
    SOKO_BOT_VERSIONS.map((version) => ({
      id: version.id,
      name: version.name,
      createdAt: version.createdAt,
      summary: version.summary,
      model: version.model,
      skills: version.skills.map((id) => {
        const skill = getSokoBotSkill(id);
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
        };
      }),
      capabilities: version.capabilities ? [...version.capabilities] : null,
      systemPrompt: composeSystemPrompt(version),
    })),
  );
});

const updateVersionRoute = createRoute({
  method: "put",
  path: "/me/version",
  operationId: "updateMySokoBotVersion",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: updateSokoBotVersionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with the new version"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(updateVersionRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    await sokoBotControlPlane.updateVersion(
      auth.userId,
      workspace.workspaceId,
      c.req.valid("json").versionId,
    );
  } catch (error) {
    mapControlPlaneError(error);
  }
  const refreshed = await sokoBotControlPlane.getForUser(
    auth.userId,
    workspace.workspaceId,
  );
  return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
});

const simulateTaskEventRoute = createRoute({
  method: "post",
  path: "/me/lab/task-event",
  operationId: "simulateMySokoBotTaskEvent",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: simulateSokoBotTaskEventRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotLabTaskEventSchema, "Simulated event"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(simulateTaskEventRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const result = await simulateSokoBotTaskEvent({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      ...c.req.valid("json"),
    });
    return ok(c, sokoBotLabTaskEventSchema.parse(result));
  } catch (error) {
    if (error instanceof SokoBotLabError) throw notFound(error.message);
    throw error;
  }
});

const BOT_TEAM_SELECT = {
  id: true,
  name: true,
  avatarImageUrl: true,
  avatarSeed: true,
  status: true,
  archivedAt: true,
  coworker: { select: { id: true } },
} as const;

const teamRoute = createRoute({
  method: "get",
  path: "/team",
  operationId: "getSokoBotTeam",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotTeamSchema,
      "People in the current workspace and their Soko Bots",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(teamRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const userSelect = {
    id: true,
    name: true,
    image: true,
    sokoBots: {
      where: { workspaceId: workspace.workspaceId, archivedAt: null },
      take: 1,
      select: BOT_TEAM_SELECT,
    },
  } as const;
  const mapBotForTeam = (bot: {
    id: string;
    name: string | null;
    avatarImageUrl: string | null;
    avatarSeed: string | null;
    status: string;
    archivedAt: Date | null;
    coworker: { id: string } | null;
  }) =>
    bot.archivedAt
      ? null
      : {
          id: bot.id,
          name: bot.name,
          avatarImageUrl: bot.avatarImageUrl,
          avatarSeed: bot.avatarSeed,
          status: bot.status,
          coworkerId: bot.coworker?.id ?? null,
        };
  if (workspace.organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: workspace.organizationId },
      select: {
        name: true,
        logo: true,
        members: {
          orderBy: { createdAt: "asc" },
          select: { role: true, user: { select: userSelect } },
        },
      },
    });
    if (!organization) throw notFound("Organization not found");
    return ok(
      c,
      sokoBotTeamSchema.parse({
        workspace: {
          id: workspace.workspaceId,
          kind: "organization",
          name: organization.name,
          logo: organization.logo,
        },
        members: organization.members.map((member) => ({
          userId: member.user.id,
          name: member.user.name,
          image: member.user.image,
          role: member.role,
          isYou: member.user.id === auth.userId,
          bot: member.user.sokoBots[0]
            ? mapBotForTeam(member.user.sokoBots[0])
            : null,
        })),
      }),
    );
  }
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: userSelect,
  });
  if (!user) throw notFound("User not found");
  return ok(
    c,
    sokoBotTeamSchema.parse({
      workspace: {
        id: workspace.workspaceId,
        kind: "personal",
        name: user.name,
        logo: user.image,
      },
      members: [
        {
          userId: user.id,
          name: user.name,
          image: user.image,
          role: null,
          isYou: true,
          bot: user.sokoBots[0] ? mapBotForTeam(user.sokoBots[0]) : null,
        },
      ],
    }),
  );
});

const statsRoute = createRoute({
  method: "get",
  path: "/me/stats",
  operationId: "getMySokoBotStats",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotDailyStatsSchema,
      "What the bot did per day over the last 30 days",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(statsRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const stats = await getSokoBotDailyStats({
    userId: auth.userId,
    workspaceId: workspace.workspaceId,
  });
  if (!stats) throw notFound("Create a Soko Bot first");
  return ok(c, sokoBotDailyStatsSchema.parse(stats));
});

const listSkillsRoute = createRoute({
  method: "get",
  path: "/me/skills",
  operationId: "listMySokoBotSkills",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotInstalledSkillSchema),
      "Installed skills",
    ),
    401: jsonErrorResponse("Unauthorized"),
  },
});

app.openapi(listSkillsRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  return ok(
    c,
    z
      .array(sokoBotInstalledSkillSchema)
      .parse(await listInstalledSkills(auth.userId, workspace.workspaceId)),
  );
});

const installSkillRoute = createRoute({
  method: "post",
  path: "/me/skills",
  operationId: "installMySokoBotSkill",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: installSokoBotSkillRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      installSokoBotSkillResponseSchema,
      "Installed skill, or the candidates to choose from",
    ),
    401: jsonErrorResponse("Unauthorized"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(installSkillRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const result = await installSkill({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      ...c.req.valid("json"),
    });
    return ok(c, installSokoBotSkillResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof SokoBotSkillError) {
      throw unprocessableEntity(error.message);
    }
    throw error;
  }
});

const removeSkillRoute = createRoute({
  method: "delete",
  path: "/me/skills/{skillId}",
  operationId: "removeMySokoBotSkill",
  tags: ["Soko Bots"],
  request: {
    params: z.object({ skillId: z.string().uuid() }),
  },
  responses: {
    200: jsonSuccessResponse(z.object({ removed: z.boolean() }), "Removed"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

app.openapi(removeSkillRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    await removeInstalledSkill(auth.userId, c.req.valid("param").skillId);
    return ok(c, { removed: true });
  } catch (error) {
    if (error instanceof SokoBotSkillError) throw notFound(error.message);
    throw error;
  }
});

const searchSkillsRoute = createRoute({
  method: "get",
  path: "/skills/search",
  operationId: "searchSokoBotSkills",
  tags: ["Soko Bots"],
  request: { query: z.object({ q: z.string().trim().min(1).max(100) }) },
  responses: {
    200: jsonSuccessResponse(
      z.array(sokoBotSkillSearchResultSchema),
      "skills.sh results",
    ),
    401: jsonErrorResponse("Unauthorized"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(searchSkillsRoute, async (c) => {
  requireUserAuthContext(c.var.authContext);
  try {
    return ok(c, await searchSkillsSh(c.req.valid("query").q));
  } catch (error) {
    if (error instanceof SokoBotSkillError) {
      throw unprocessableEntity(error.message);
    }
    throw error;
  }
});

const browseSkillsRoute = createRoute({
  method: "get",
  path: "/skills/browse",
  operationId: "browseSokoBotSkills",
  tags: ["Soko Bots"],
  request: {
    query: z.object({
      page: z.coerce.number().int().min(0).max(50).default(0),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      sokoBotSkillBrowseSchema,
      "skills.sh leaderboard page",
    ),
    401: jsonErrorResponse("Unauthorized"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(browseSkillsRoute, async (c) => {
  requireUserAuthContext(c.var.authContext);
  try {
    return ok(
      c,
      sokoBotSkillBrowseSchema.parse(
        await browseSkillsSh(c.req.valid("query").page),
      ),
    );
  } catch (error) {
    if (error instanceof SokoBotSkillError) {
      throw unprocessableEntity(error.message);
    }
    throw error;
  }
});

const listLabRunsRoute = createRoute({
  method: "get",
  path: "/me/lab/runs",
  operationId: "listMySokoBotLabRuns",
  tags: ["Soko Bots"],
  request: { query: listSokoBotLabRunsQuerySchema },
  responses: {
    200: jsonSuccessResponse(z.array(sokoBotLabRunSchema), "Recorded lab runs"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

app.openapi(listLabRunsRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  const { versionId, limit } = c.req.valid("query");
  const runs = await prisma.sokoBotLabRun.findMany({
    where: { userId: auth.userId, ...(versionId ? { versionId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      turn: {
        select: { durationMs: true, costUsdMicros: true },
      },
    },
  });
  return ok(
    c,
    z.array(sokoBotLabRunSchema).parse(
      runs.map(({ turn, ...run }) => ({
        ...run,
        judge: run.judge ?? null,
        durationMs: turn.durationMs,
        costUsd:
          turn.costUsdMicros === null ? null : Number(turn.costUsdMicros) / 1e6,
      })),
    ),
  );
});

const judgeLabTurnRoute = createRoute({
  method: "post",
  path: "/me/lab/judge",
  operationId: "judgeMySokoBotLabTurn",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: judgeSokoBotLabTurnRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotLabVerdictSchema, "Judge verdict"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

app.openapi(judgeLabTurnRoute, async (c) => {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    const { verdict, model } = await judgeSokoBotLabTurn({
      userId: auth.userId,
      ...c.req.valid("json"),
    });
    return ok(c, sokoBotLabVerdictSchema.parse({ model, ...verdict }));
  } catch (error) {
    if (error instanceof SokoBotLabJudgeError) throw notFound(error.message);
    throw error;
  }
});

export default app;
