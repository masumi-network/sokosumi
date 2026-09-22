import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { sokoBotDeletionResultSchema } from "@/schemas/soko-bot.schema";
import { deleteSokoBot } from "@/services/soko-bot-deletion.service";

const deleteBotRoute = createRoute({
  method: "delete",
  path: "/{sokoBotId}",
  operationId: "deleteAdminSokoBot",
  tags: ["Admin"],
  request: { params: z.object({ sokoBotId: z.string().uuid() }) },
  responses: {
    200: jsonSuccessResponse(sokoBotDeletionResultSchema, "Soko Bot deleted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(deleteBotRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    // No SokoBotAdminAction row: that table is foreign-keyed to the bot, so an
    // audit entry would either violate the constraint or be cascaded away with
    // the row it describes. Deletions are captured by request logging instead.
    const result = await deleteSokoBot(c.req.valid("param").sokoBotId);
    return ok(c, result);
  });
}
