import { createRoute, z } from "@hono/zod-openapi";
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
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  createSokoBotRequestSchema,
  createSokoBotScheduleRequestSchema,
  resolveSokoBotDecisionRequestSchema,
  sokoBotMemorySchema,
  sokoBotPendingDecisionSchema,
  sokoBotScheduleSchema,
  sokoBotSchema,
  sokoBotStateSchema,
  sokoBotTurnSchema,
  startSokoBotTurnRequestSchema,
  startSokoBotTurnResponseSchema,
  updateSokoBotScheduleRequestSchema,
} from "@/schemas/soko-bot.schema";
import { SokoBotBillingAccessError } from "@/services/soko-bot-billing.service";
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
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
  sokoBotRuntimeService,
} from "@/services/soko-bot-runtime.service";

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
    memoryRevisions: undefined,
  };
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
  const bot = await sokoBotControlPlane.getForUser(auth.userId);
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
  try {
    await sokoBotControlPlane.create({
      userId: auth.userId,
      ...c.req.valid("json"),
    });
    const bot = await sokoBotControlPlane.getForUser(auth.userId);
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
  await sokoBotControlPlane.archive(auth.userId);
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
  const query = c.req.valid("query");
  const { cursor, take } = parseCursorPagination(query);
  const { turns, count, hasMore } = await sokoBotControlPlane.listTurns(
    auth.userId,
    { cursor, take },
  );
  return ok(
    c,
    z.array(sokoBotTurnSchema).parse(turns),
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
    return ok(c, sokoBotTurnSchema.parse(turn));
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
  try {
    const memory = await sokoBotControlPlane.resetMemory(auth.userId);
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

export default app;
