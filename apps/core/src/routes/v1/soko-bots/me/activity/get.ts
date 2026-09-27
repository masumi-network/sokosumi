import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotActivitySchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

// Polled every couple of seconds by the console, which watches turns started
// elsewhere. One indexed read, so it can be asked often enough to catch a turn
// that only runs for a few seconds.
const getMyActivityRoute = createRoute({
  method: "get",
  path: "/me/activity",
  operationId: "getMySokoBotActivity",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotActivitySchema,
      "Whether the assistant is working right now",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getMyActivityRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const activity = await sokoBotControlPlane.getActivityForUser(
      auth.userId,
      workspace.workspaceId,
    );
    if (!activity) throw notFound("Soko Bot not found");
    return ok(c, sokoBotActivitySchema.parse(activity));
  });
}
