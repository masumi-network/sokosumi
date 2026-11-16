import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireOverview, rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoOverviewSchema,
  cmoProjectParamsSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";
import { pauseCmoCalendarEntry } from "@/services/cmo-strategy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/calendar/{id}/pause",
  operationId: "pauseCmoCalendarEntryForProject",
  tags: ["CMO"],
  description:
    "Pauses one calendar entry's Social post: cancels it so it cannot go out. The approved plan stays as it is.",
  request: {
    params: cmoProjectParamsSchema.extend(cmoUpdateIdParamsSchema.shape),
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Entry paused"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse(
      "Not a planned Social post, or it can no longer be canceled",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    await pauseCmoCalendarEntry({ userId, projectId, entryId: id }).catch(
      rethrow,
    );
    return ok(c, await requireOverview({ userId, projectId }));
  });
}
