import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  setSokoBotAvatarCodeRequestSchema,
  sokoBotAvatarCodeSchema,
} from "@/schemas/soko-bot-avatar.schema";
import { setSokoBotAvatarCode } from "@/services/soko-bot-avatar-code.service";

const setAvatarCodeRoute = createRoute({
  method: "put",
  path: "/{sokoBotId}/avatar-code",
  operationId: "setAdminSokoBotAvatarCode",
  tags: ["Admin"],
  request: {
    params: z.object({ sokoBotId: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: setSokoBotAvatarCodeRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotAvatarCodeSchema, "The bot's new look"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Another bot already has this look"),
    422: jsonErrorResponse("Not a valid avatar code"),
  },
});

/** Give any bot a look by its avatar code. */
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(setAvatarCodeRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { sokoBotId } = c.req.valid("param");
    const bot = await prisma.sokoBot.findUnique({
      where: { id: sokoBotId, deletedAt: null },
      select: { id: true },
    });
    if (!bot) throw notFound("Soko Bot not found");
    return ok(c, await setSokoBotAvatarCode(bot.id, c.req.valid("json").code));
  });
}
