import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { clearCmoPresenter } from "@/services/cmo-presenter.service";

const route = createRoute({
  method: "delete",
  path: "/projects/{projectId}/presenter",
  operationId: "clearCmoPresenterForProject",
  tags: ["CMO"],
  description:
    "Stop using the owner's photo in talking videos; generated presenters front them again.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.object({ presenterSet: z.literal(false) }),
      "Photo removed",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    await clearCmoPresenter({ userId, projectId }).catch(rethrow);
    return ok(c, { presenterSet: false as const });
  });
}
