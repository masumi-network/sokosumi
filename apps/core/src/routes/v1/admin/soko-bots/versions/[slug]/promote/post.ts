import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { promoteSokoBotVersion } from "@/services/soko-bot-version.service";

const promoteVersionRoute = createRoute({
  method: "post",
  path: "/versions/{slug}/promote",
  operationId: "promoteAdminSokoBotVersion",
  tags: ["Admin"],
  request: { params: z.object({ slug: z.string().min(2).max(41) }) },
  responses: {
    200: jsonSuccessResponse(
      z.object({ defaultVersionId: z.string() }),
      "New bots are created on this version",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(promoteVersionRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { slug } = c.req.valid("param");
    await promoteSokoBotVersion(slug);
    return ok(c, { defaultVersionId: slug });
  });
}
