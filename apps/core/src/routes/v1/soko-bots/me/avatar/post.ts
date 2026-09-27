import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotSchema } from "@/schemas/soko-bot.schema";
import { claimSokoBotAvatarRequestSchema } from "@/schemas/soko-bot-avatar.schema";
import { claimAvatar } from "@/services/soko-bot-avatar.service";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapBot } from "../../helpers.js";

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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(claimAvatarRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const bot = await sokoBotControlPlane.getForUser(
      auth.userId,
      workspace.workspaceId,
    );
    if (!bot) throw notFound("Create a Soko Bot first");
    await claimAvatar(bot.id, c.req.valid("json").avatarId);
    const refreshed = await sokoBotControlPlane.getForUser(
      auth.userId,
      workspace.workspaceId,
    );
    return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
  });
}
