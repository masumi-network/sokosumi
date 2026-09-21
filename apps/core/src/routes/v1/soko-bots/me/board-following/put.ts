import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  sokoBotSchema,
  updateSokoBotBoardFollowingRequestSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapBot } from "../../helpers.js";

const updateBoardFollowingRoute = createRoute({
  method: "put",
  path: "/me/board-following",
  operationId: "updateMySokoBotBoardFollowing",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: updateSokoBotBoardFollowingRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with the new setting"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(updateBoardFollowingRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const updated = await prisma.sokoBot.updateMany({
      where: {
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        archivedAt: null,
      },
      data: { followWholeBoard: c.req.valid("json").enabled },
    });
    if (updated.count === 0) throw notFound("Create a Soko Bot first");
    const refreshed = await sokoBotControlPlane.getForUser(
      auth.userId,
      workspace.workspaceId,
    );
    return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
  });
}
