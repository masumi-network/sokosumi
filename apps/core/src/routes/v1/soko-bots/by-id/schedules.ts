import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createSokoBotScheduleRequestSchema,
  sokoBotDailyStatsSchema,
  sokoBotScheduleSchema,
  updateSokoBotScheduleRequestSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { getSokoBotDailyStats } from "@/services/soko-bot-stats.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
  sokoBotIdSelector,
} from "../bot-selector.js";
import { mapControlPlaneError, scheduleParams } from "../helpers.js";

/**
 * Schedules and stats of a bot by id. Any member who reaches a shared bot
 * may delete its schedules; adding or changing one also needs their Seat.
 * The Requester stays whoever asked first (ADR 0057).
 */
const tags = ["Soko Bots"];
const scheduleByIdParams = scheduleParams.extend(sokoBotIdParams.shape);

const createScheduleRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/schedules",
  operationId: "createSokoBotSchedule",
  tags,
  request: {
    params: sokoBotIdParams,
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

const updateScheduleRoute = createRoute({
  method: "patch",
  path: "/{sokoBotId}/schedules/{scheduleId}",
  operationId: "updateSokoBotSchedule",
  tags,
  request: {
    params: scheduleByIdParams,
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

const deleteScheduleRoute = createRoute({
  method: "delete",
  path: "/{sokoBotId}/schedules/{scheduleId}",
  operationId: "deleteSokoBotSchedule",
  tags,
  request: { params: scheduleByIdParams },
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

const statsRoute = createRoute({
  method: "get",
  path: "/{sokoBotId}/stats",
  operationId: "getSokoBotStats",
  tags,
  request: { params: sokoBotIdParams },
  responses: {
    200: jsonSuccessResponse(
      sokoBotDailyStatsSchema,
      "What the bot did per day over the last 30 days",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export function mountSokoBotScheduleByIdRoutes(app: OpenAPIHonoWithAuth) {
  app.openapi(createScheduleRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const bot = await requireReachableSokoBot(
        auth.userId,
        workspace.workspaceId,
        c.req.valid("param").sokoBotId,
      );
      const schedule = await sokoBotControlPlane.createSchedule({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        sokoBotId: bot.id,
        ...c.req.valid("json"),
      });
      return created(c, sokoBotScheduleSchema.parse(schedule));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });

  app.openapi(updateScheduleRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { scheduleId, sokoBotId } = c.req.valid("param");
    try {
      const schedule = await sokoBotControlPlane.updateSchedule({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        sokoBotId,
        scheduleId,
        ...c.req.valid("json"),
      });
      return ok(c, sokoBotScheduleSchema.parse(schedule));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });

  app.openapi(deleteScheduleRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { scheduleId, sokoBotId } = c.req.valid("param");
    try {
      await sokoBotControlPlane.deleteSchedule(auth.userId, scheduleId, {
        workspaceId: workspace.workspaceId,
        sokoBotId,
      });
      return ok(c, { deleted: true as const });
    } catch (error) {
      mapControlPlaneError(error);
    }
  });

  app.openapi(statsRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const stats = await getSokoBotDailyStats({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      selector: sokoBotIdSelector(c.req.valid("param")),
    });
    if (!stats) throw notFound("Soko Bot not found");
    return ok(c, sokoBotDailyStatsSchema.parse(stats));
  });
}
