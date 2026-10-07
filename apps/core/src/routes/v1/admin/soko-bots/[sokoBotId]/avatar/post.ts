import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { claimSokoBotAvatarRequestSchema } from "@/schemas/soko-bot-avatar.schema";
import { claimAvatar } from "@/services/soko-bot-avatar.service";

const setAvatarRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/avatar",
  operationId: "setAdminSokoBotAvatar",
  tags: ["Admin"],
  request: {
    params: z.object({ sokoBotId: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: claimSokoBotAvatarRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ avatarImageUrl: z.string() }),
      "The bot's new mascot",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

/** Give any bot a mascot from the shared pool, the way its owner would. */
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(setAvatarRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { sokoBotId } = c.req.valid("param");
    const bot = await prisma.sokoBot.findUnique({
      where: { id: sokoBotId },
      select: { id: true },
    });
    if (!bot) throw notFound("Soko Bot not found");
    const avatarImageUrl = await claimAvatar(
      bot.id,
      c.req.valid("json").avatarId,
    );
    return ok(c, { avatarImageUrl });
  });
}
