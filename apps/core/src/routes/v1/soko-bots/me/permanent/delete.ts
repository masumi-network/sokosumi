import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotDeletionResultSchema } from "@/schemas/soko-bot.schema";
import { deleteSokoBotForUser } from "@/services/soko-bot-deletion.service";

const deleteMeRoute = createRoute({
  method: "delete",
  path: "/me/permanent",
  operationId: "deleteMySokoBotPermanently",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotDeletionResultSchema,
      "Soko Bot deleted; the owner may create a new one immediately",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(deleteMeRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const result = await deleteSokoBotForUser(
      auth.userId,
      workspace.workspaceId,
    );
    return ok(c, result);
  });
}
