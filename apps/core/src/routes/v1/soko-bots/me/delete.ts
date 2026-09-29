import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

const archiveMeRoute = createRoute({
  method: "delete",
  path: "/me",
  operationId: "archiveMySokoBot",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      z.object({ archived: z.literal(true) }),
      "Archive Soko Bot",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(archiveMeRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    await sokoBotControlPlane.archive(auth.userId, workspace.workspaceId);
    return ok(c, { archived: true as const });
  });
}
