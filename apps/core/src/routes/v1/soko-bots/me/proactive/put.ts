import { createRoute } from "@hono/zod-openapi";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  sokoBotSchema,
  updateSokoBotProactiveRequestSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { retimeSystemSchedules } from "@/services/soko-bot-proactive.service";
import { mapBot } from "../../helpers.js";

const updateProactiveRoute = createRoute({
  method: "put",
  path: "/me/proactive",
  operationId: "updateMySokoBotProactive",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: updateSokoBotProactiveRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with the new settings"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(updateProactiveRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
      } catch {
        throw unprocessableEntity("Unknown timezone");
      }
    }
    const bot = await prisma.sokoBot.findFirst({
      where: {
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!bot) throw notFound("Create a Soko Bot first");
    await prisma.sokoBot.update({
      where: { id: bot.id },
      data: {
        ...(body.paused !== undefined ? { proactivePaused: body.paused } : {}),
        ...(body.dailyLimit !== undefined
          ? { proactiveDailyLimit: body.dailyLimit }
          : {}),
        ...(body.timezone ? { ingestTimezone: body.timezone } : {}),
      },
    });
    if (body.timezone) await retimeSystemSchedules(bot.id, body.timezone);
    const refreshed = await sokoBotControlPlane.getForUser(
      auth.userId,
      workspace.workspaceId,
    );
    return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
  });
}
