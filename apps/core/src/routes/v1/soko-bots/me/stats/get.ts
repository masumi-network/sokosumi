import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotDailyStatsSchema } from "@/schemas/soko-bot.schema";
import { getSokoBotDailyStats } from "@/services/soko-bot-stats.service";

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

export default function mount(app: OpenAPIHonoWithAuth) {
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
}
